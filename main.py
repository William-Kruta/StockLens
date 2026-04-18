import logging

from secrs.data.db import init_tables

from secrs.ticker import Ticker, Tickers
from secrs.screener import screen_tickers, view_screener_options
from secrs.dcf import batch_dcf


def test():
    conn = init_tables()
    conn.execute("DROP TABLE candles")
    conn.commit()


def main():
    # logging.basicConfig(
    #     level=logging.DEBUG,
    #     format="%(asctime)s %(name)s %(levelname)s %(message)s",
    # )
    df = batch_dcf(["AAPL", "MSFT", "GOOG", "NVDA", "META"], auto=True)
    print(df)
    exit()
    # df = get_filings_metadata("RKLB", "10-K", conn=con
    results = screen_tickers(
        ["AAPL", "MSFT", "GOOG", "NVDA"],
        pe_ratio=("<", 35),
        gross_margin=(">", 0.40),
        revenue_growth=(">", 0.08),
        debt_to_equity=("<", 2.0),
        include_metrics=["market_cap", "enterprise_value"],
    )
    print(f"Results: {results}")


if __name__ == "__main__":
    main()
