import datetime as dt
import sqlite3
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import polars as pl
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from secrs.data.db import init_tables


# --- _find_stale_tickers tests ---

def test_find_stale_tickers_empty_returns_empty():
    from secrs.periphery.statement_loader import _find_stale_tickers
    empty = pl.DataFrame(schema={"ticker": pl.Utf8, "period_end": pl.Utf8})
    assert _find_stale_tickers(empty, "10-K", False) == []


def test_find_stale_tickers_force_refresh_returns_all():
    from secrs.periphery.statement_loader import _find_stale_tickers
    cached = pl.DataFrame({
        "ticker": ["AAPL", "MSFT"],
        "period_end": ["2024-12-31", "2024-09-30"],
    })
    result = _find_stale_tickers(cached, "10-K", force_refresh=True)
    assert set(result) == {"AAPL", "MSFT"}


def test_find_stale_tickers_fresh_data_not_stale():
    from secrs.periphery.statement_loader import _find_stale_tickers
    # Data from 30 days ago — well within 10-Q threshold of 90 days
    recent = (dt.date.today() - dt.timedelta(days=30)).isoformat()
    cached = pl.DataFrame({"ticker": ["AAPL"], "period_end": [recent]})
    result = _find_stale_tickers(cached, "10-Q", force_refresh=False)
    assert result == []


def test_find_stale_tickers_old_data_is_stale():
    from secrs.periphery.statement_loader import _find_stale_tickers
    # Data from 400 days ago — exceeds 10-Q threshold of 90 days
    old = (dt.date.today() - dt.timedelta(days=400)).isoformat()
    cached = pl.DataFrame({"ticker": ["AAPL"], "period_end": [old]})
    result = _find_stale_tickers(cached, "10-Q", force_refresh=False)
    assert "AAPL" in result


def test_find_stale_tickers_10k_threshold():
    from secrs.periphery.statement_loader import _find_stale_tickers
    # 380 days — stale for 10-Q (90d) but NOT stale for 10-K (420d)
    moderate = (dt.date.today() - dt.timedelta(days=380)).isoformat()
    cached = pl.DataFrame({"ticker": ["AAPL"], "period_end": [moderate]})
    assert _find_stale_tickers(cached, "10-Q", force_refresh=False) == ["AAPL"]
    assert _find_stale_tickers(cached, "10-K", force_refresh=False) == []


# --- batch_get_statements force_refresh tests ---

def test_batch_get_statements_accepts_force_refresh_param():
    """batch_get_statements must accept force_refresh without error."""
    import inspect
    from secrs.periphery.statement_loader import batch_get_statements
    sig = inspect.signature(batch_get_statements)
    assert "force_refresh" in sig.parameters


def test_get_statements_accepts_force_refresh_param():
    import inspect
    from secrs.periphery.statement_loader import get_statements
    sig = inspect.signature(get_statements)
    assert "force_refresh" in sig.parameters


def test_batch_get_statements_upserts_stale_tickers(tmp_path):
    """When cached ticker is stale, it re-fetches and upserts."""
    from secrs.periphery.statement_loader import batch_get_statements

    db_path = str(tmp_path / "test.db")
    conn = init_tables(db_path)

    old_period = (dt.date.today() - dt.timedelta(days=400)).isoformat()
    # Seed the DB with old data for AAPL
    conn.execute(
        "INSERT OR IGNORE INTO statements "
        "(ticker, filing_type, accession_number, statement_name, concept, label, value, period_end, period_start, unit, fiscal_period) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        ("AAPL", "10-Q", "0001234567-00-000001", "IncomeStatement", "Revenues", "Revenue", "1000", old_period, None, "USD", "Q1"),
    )
    conn.commit()

    new_period = dt.date.today().isoformat()
    fresh_df = pl.DataFrame({
        "ticker": ["AAPL"],
        "filing_type": ["10-Q"],
        "accession_number": ["0001234567-00-000002"],
        "statement_name": ["IncomeStatement"],
        "concept": ["Revenues"],
        "label": ["Revenue"],
        "value": ["2000"],
        "period_end": [new_period],
        "period_start": [None],
        "unit": ["USD"],
        "fiscal_period": ["Q2"],
    })

    cols = ["ticker", "filing_type", "accession_number", "statement_name", "concept", "label", "value", "period_end", "period_start", "unit", "fiscal_period"]

    with patch("secrs.periphery.statement_loader._fetch_statement", return_value=fresh_df) as mock_fetch, \
         patch("secrs.periphery.statement_loader.get_cik", return_value="0000320193"):
        result = batch_get_statements(
            tickers=["AAPL"],
            statement_name="IncomeStatement",
            statement_columns=cols,
            pk_cols=["ticker", "filing_type", "accession_number", "concept", "period_end"],
            concepts=["Revenues"],
            quarterly=True,
            conn=conn,
            force_refresh=False,  # data is stale so auto-refresh should trigger
        )
        mock_fetch.assert_called_once()

    assert not result.is_empty()
