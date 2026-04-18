import inspect
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))


def test_get_income_statement_has_force_refresh_param():
    from secrs.modules.income_statement import get_income_statement
    sig = inspect.signature(get_income_statement)
    assert "force_refresh" in sig.parameters


def test_batch_get_income_statements_has_force_refresh_param():
    from secrs.modules.income_statement import batch_get_income_statements
    sig = inspect.signature(batch_get_income_statements)
    assert "force_refresh" in sig.parameters


def test_income_statement_init_has_force_refresh_param():
    from secrs.modules.income_statement import IncomeStatement
    sig = inspect.signature(IncomeStatement.__init__)
    assert "force_refresh" in sig.parameters


def test_ratios_property_removed():
    from secrs.modules.income_statement import IncomeStatement
    assert "ratios" not in IncomeStatement.__dict__, "broken ratios property should not exist"
