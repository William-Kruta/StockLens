from unittest.mock import MagicMock, patch

import pytest

from secrs.ticker import Ticker, Tickers


@pytest.fixture
def mock_conn():
    with patch("secrs.ticker.init_tables", return_value=MagicMock()) as mock:
        yield mock.return_value


def test_ticker_init_does_not_instantiate_statement_classes(mock_conn):
    with (
        patch("secrs.ticker.IncomeStatement") as mock_is,
        patch("secrs.ticker.BalanceSheet") as mock_bs,
        patch("secrs.ticker.CashFlow") as mock_cf,
    ):
        Ticker("AAPL", conn=mock_conn)
    mock_is.assert_not_called()
    mock_bs.assert_not_called()
    mock_cf.assert_not_called()


def test_ticker_income_statement_instantiated_on_first_access(mock_conn):
    with (
        patch("secrs.ticker.IncomeStatement") as mock_is,
        patch("secrs.ticker.BalanceSheet"),
        patch("secrs.ticker.CashFlow"),
    ):
        ticker = Ticker("AAPL", conn=mock_conn)
        _ = ticker.income_statement
    mock_is.assert_called_once()


def test_ticker_balance_sheet_instantiated_on_first_access(mock_conn):
    with (
        patch("secrs.ticker.IncomeStatement"),
        patch("secrs.ticker.BalanceSheet") as mock_bs,
        patch("secrs.ticker.CashFlow"),
    ):
        ticker = Ticker("AAPL", conn=mock_conn)
        _ = ticker.balance_sheet
    mock_bs.assert_called_once()


def test_ticker_cash_flow_instantiated_on_first_access(mock_conn):
    with (
        patch("secrs.ticker.IncomeStatement"),
        patch("secrs.ticker.BalanceSheet"),
        patch("secrs.ticker.CashFlow") as mock_cf,
    ):
        ticker = Ticker("AAPL", conn=mock_conn)
        _ = ticker.cash_flow
    mock_cf.assert_called_once()


def test_ticker_statement_cached_after_first_access(mock_conn):
    with (
        patch("secrs.ticker.IncomeStatement") as mock_is,
        patch("secrs.ticker.BalanceSheet"),
        patch("secrs.ticker.CashFlow"),
    ):
        ticker = Ticker("AAPL", conn=mock_conn)
        _ = ticker.income_statement
        _ = ticker.income_statement
    mock_is.assert_called_once()


def test_tickers_get_balance_sheets_method_exists():
    methods = Tickers.__dict__
    assert "get_balance_sheets" in methods
    assert "get_balance_sheet" not in methods


def test_segments_not_cached_between_calls(mock_conn):
    with (
        patch("secrs.ticker.IncomeStatement"),
        patch("secrs.ticker.BalanceSheet"),
        patch("secrs.ticker.CashFlow"),
        patch("secrs.ticker.get_revenue_by_segment", return_value=MagicMock()) as mock_seg,
    ):
        ticker = Ticker("AAPL", conn=mock_conn)
        ticker.segments(start_date="2020-01-01")
        ticker.segments(start_date="2022-01-01")
    assert mock_seg.call_count == 2
