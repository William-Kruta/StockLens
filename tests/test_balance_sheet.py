import polars as pl

from secrs.modules.balance_sheet import _merge_annual_into_quarterly


def _make_df(period_ends: list[str], filing_type: str = "10-Q") -> pl.DataFrame:
    rows = []
    for pe in period_ends:
        rows.append(
            {
                "ticker": "AAPL",
                "filing_type": filing_type,
                "accession_number": f"acc-{pe}",
                "statement_name": "balance_sheet",
                "concept": "Assets",
                "label": "Total Assets",
                "value": 1000.0,
                "period_end": pe,
                "period_start": None,
                "unit": "USD",
                "fiscal_period": "FY" if filing_type == "10-K" else "Q3",
            }
        )
    return pl.DataFrame(rows, infer_schema_length=None)


def test_merge_adds_annual_period_ends_missing_from_quarterly():
    quarterly = _make_df(["2024-09-30", "2024-06-30"])
    annual = _make_df(["2023-12-31"], filing_type="10-K")

    result = _merge_annual_into_quarterly("AAPL", quarterly, annual)

    period_ends = set(result["period_end"].to_list())
    assert "2023-12-31" in period_ends
    assert "2024-09-30" in period_ends


def test_merge_does_not_duplicate_existing_period_ends():
    quarterly = _make_df(["2023-12-31", "2024-09-30"])
    annual = _make_df(["2023-12-31"], filing_type="10-K")

    result = _merge_annual_into_quarterly("AAPL", quarterly, annual)

    count = result.filter(pl.col("period_end") == "2023-12-31").height
    assert count == 1


def test_merge_returns_quarterly_unchanged_when_annual_empty():
    quarterly = _make_df(["2024-09-30"])
    annual = pl.DataFrame()

    result = _merge_annual_into_quarterly("AAPL", quarterly, annual)

    assert result.equals(quarterly)
