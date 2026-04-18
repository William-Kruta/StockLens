from unittest.mock import patch

import polars as pl
import pytest

from secrs.data.db import init_tables
from secrs.modules.cash_flow import _ensure_annual_for_fill_q4


@pytest.fixture
def conn():
    return init_tables(":memory:")


def _make_cf_df(period_ends: list[str], filing_type: str = "10-Q") -> pl.DataFrame:
    rows = []
    for pe in period_ends:
        rows.append(
            {
                "ticker": "AAPL",
                "filing_type": filing_type,
                "accession_number": f"acc-{pe}",
                "statement_name": "cash_flow",
                "concept": "NetCashProvidedByUsedInOperatingActivities",
                "label": "Operating Cash Flow",
                "value": 500.0,
                "period_end": pe,
                "period_start": f"{pe[:4]}-01-01",
                "unit": "USD",
                "fiscal_period": "FY" if filing_type == "10-K" else "Q3",
            }
        )
    return pl.DataFrame(rows, infer_schema_length=None)


def test_returns_annual_data_when_annual_is_ahead(conn):
    annual = _make_cf_df(["2023-12-31"], filing_type="10-K")
    quarterly = _make_cf_df(["2023-09-30"])

    from secrs.data.db import STATEMENT_COLUMNS, STATEMENT_PK_COLUMNS, insert_data

    insert_data(
        annual,
        db_cols=STATEMENT_COLUMNS,
        table_name="statements",
        conn=conn,
        pk_cols=STATEMENT_PK_COLUMNS,
    )

    with patch("secrs.modules.cash_flow.fetch_xbrl_statement") as mock_fetch:
        result = _ensure_annual_for_fill_q4("AAPL", quarterly, conn)

    mock_fetch.assert_not_called()
    assert not result.is_empty()


def test_returns_annual_when_quarterly_is_empty(conn):
    annual = _make_cf_df(["2023-12-31"], filing_type="10-K")

    from secrs.data.db import STATEMENT_COLUMNS, STATEMENT_PK_COLUMNS, insert_data

    insert_data(
        annual,
        db_cols=STATEMENT_COLUMNS,
        table_name="statements",
        conn=conn,
        pk_cols=STATEMENT_PK_COLUMNS,
    )

    result = _ensure_annual_for_fill_q4("AAPL", pl.DataFrame(), conn)

    assert not result.is_empty()
