import inspect
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))


def test_merge_annual_into_quarterly_is_module_level_function():
    """_merge_annual_into_quarterly must exist as a module-level function."""
    from secrs.modules import balance_sheet as bs_module
    assert hasattr(bs_module, "_merge_annual_into_quarterly"), \
        "_merge_annual_into_quarterly not found at module level"
    assert callable(bs_module._merge_annual_into_quarterly)


def test_merge_annual_signature():
    from secrs.modules.balance_sheet import _merge_annual_into_quarterly
    sig = inspect.signature(_merge_annual_into_quarterly)
    params = list(sig.parameters.keys())
    assert "ticker" in params
    assert "quarterly_data" in params
    assert "conn" in params


def test_get_balance_sheet_has_force_refresh():
    from secrs.modules.balance_sheet import get_balance_sheet
    sig = inspect.signature(get_balance_sheet)
    assert "force_refresh" in sig.parameters


def test_batch_get_balance_sheets_has_force_refresh():
    from secrs.modules.balance_sheet import batch_get_balance_sheets
    sig = inspect.signature(batch_get_balance_sheets)
    assert "force_refresh" in sig.parameters


def test_balance_sheet_init_has_force_refresh():
    from secrs.modules.balance_sheet import BalanceSheet
    sig = inspect.signature(BalanceSheet.__init__)
    assert "force_refresh" in sig.parameters
