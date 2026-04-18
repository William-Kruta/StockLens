import pytest
import polars as pl
from secrs.data.db import init_tables, insert_data, STATEMENT_COLUMNS, STATEMENT_PK_COLUMNS


def _sample_row(value: float = 100.0, period_end: str = "2024-12-31") -> pl.DataFrame:
    return pl.DataFrame([{
        "ticker": "AAPL",
        "filing_type": "10-K",
        "accession_number": "0001234567-24-000001",
        "statement_name": "income_statement",
        "concept": "Revenues",
        "label": "Revenue",
        "value": value,
        "period_end": period_end,
        "period_start": "2024-01-01",
        "unit": "USD",
        "fiscal_period": "FY",
    }])


@pytest.fixture
def conn():
    return init_tables(":memory:")


def test_insert_ignore_does_not_overwrite(conn):
    insert_data(_sample_row(100.0), db_cols=STATEMENT_COLUMNS, table_name="statements",
                conn=conn, pk_cols=STATEMENT_PK_COLUMNS, upsert=False)
    insert_data(_sample_row(200.0), db_cols=STATEMENT_COLUMNS, table_name="statements",
                conn=conn, pk_cols=STATEMENT_PK_COLUMNS, upsert=False)
    row = conn.execute("SELECT value FROM statements WHERE ticker='AAPL'").fetchone()
    assert row[0] == 100.0


def test_upsert_overwrites_existing_row(conn):
    insert_data(_sample_row(100.0), db_cols=STATEMENT_COLUMNS, table_name="statements",
                conn=conn, pk_cols=STATEMENT_PK_COLUMNS, upsert=False)
    insert_data(_sample_row(200.0), db_cols=STATEMENT_COLUMNS, table_name="statements",
                conn=conn, pk_cols=STATEMENT_PK_COLUMNS, upsert=True)
    row = conn.execute("SELECT value FROM statements WHERE ticker='AAPL'").fetchone()
    assert row[0] == 200.0


def test_upsert_false_is_default(conn):
    """upsert defaults to False — calling without it should behave as INSERT OR IGNORE."""
    insert_data(_sample_row(100.0), db_cols=STATEMENT_COLUMNS, table_name="statements",
                conn=conn, pk_cols=STATEMENT_PK_COLUMNS)
    insert_data(_sample_row(999.0), db_cols=STATEMENT_COLUMNS, table_name="statements",
                conn=conn, pk_cols=STATEMENT_PK_COLUMNS)
    row = conn.execute("SELECT value FROM statements WHERE ticker='AAPL'").fetchone()
    assert row[0] == 100.0


def test_marketcap_table_does_not_exist(conn):
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='marketcap'"
    )
    assert cursor.fetchone() is None


def test_ratios_table_does_not_exist(conn):
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='ratios'"
    )
    assert cursor.fetchone() is None
