import polars as pl

from secrs.utils.formatting import (
    _align_annual_pivot_columns_by_year,
    _align_quarterly_pivot_columns_by_quarter,
)


def test_align_annual_merges_same_year_columns():
    df = pl.DataFrame(
        {
            "label": ["Revenue"],
            "03/31/2024": [100.0],
            "12/31/2024": [None],
        }
    )
    result = _align_annual_pivot_columns_by_year(df)
    assert "2024" in result.columns
    assert "03/31/2024" not in result.columns
    assert result["2024"].to_list() == [100.0]


def test_align_annual_coalesces_nulls():
    df = pl.DataFrame(
        {
            "label": ["Revenue"],
            "03/31/2024": [None],
            "12/31/2024": [200.0],
        }
    )
    result = _align_annual_pivot_columns_by_year(df)
    assert result["2024"].to_list() == [200.0]


def test_align_annual_preserves_passthrough_columns():
    df = pl.DataFrame(
        {
            "label": ["Revenue"],
            "ticker": ["AAPL"],
            "12/31/2024": [100.0],
        }
    )
    result = _align_annual_pivot_columns_by_year(df)
    assert "label" in result.columns
    assert "ticker" in result.columns
    assert "2024" in result.columns


def test_align_annual_empty_df_returns_empty():
    df = pl.DataFrame({"label": [], "12/31/2024": []})
    result = _align_annual_pivot_columns_by_year(df)
    assert result.is_empty()


def test_align_quarterly_merges_same_quarter_columns():
    df = pl.DataFrame(
        {
            "label": ["Revenue"],
            "03/31/2024": [100.0],
            "03/30/2024": [None],
        }
    )
    result = _align_quarterly_pivot_columns_by_quarter(df)
    assert "Q1 2024" in result.columns
    assert result["Q1 2024"].to_list() == [100.0]


def test_align_quarterly_preserves_passthrough_columns():
    df = pl.DataFrame(
        {
            "label": ["Revenue"],
            "ticker": ["AAPL"],
            "06/30/2024": [50.0],
        }
    )
    result = _align_quarterly_pivot_columns_by_quarter(df)
    assert "label" in result.columns
    assert "ticker" in result.columns
    assert "Q2 2024" in result.columns
