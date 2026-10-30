"""No paid calls: validate the live-test opt-in gates and representative inputs."""
import json
import subprocess
import sys
from pathlib import Path

from tools.plotloom_novel_quality import CASES
from tools.plotloom_long_concurrency import chapter_input, STAGES
from agent.studio_api import WorkInput

SCRIPT=Path(__file__).resolve().parents[1]/'tools/plotloom_long_concurrency.py'


def test_dry_run_has_bounded_cost_and_creates_no_files(tmp_path):
    target=tmp_path/'absent'
    result=subprocess.run([sys.executable,str(SCRIPT),'--report-dir',str(target)],text=True,capture_output=True,check=True)
    plan=json.loads(result.stdout)
    assert plan['dry_run'] and plan['maximum_paid_jobs']==25 and plan['stages']==[5,10,10]
    assert plan['max_tokens']==12000 and plan['thinking']=='provider-default'
    assert not target.exists()


def test_both_live_flags_are_required_before_config_or_network_access(tmp_path):
    for flag in ['--real-model','--apply-concurrency']:
        target=tmp_path/flag
        result=subprocess.run([sys.executable,str(SCRIPT),'--report-dir',str(target),flag],capture_output=True)
        assert result.returncode==2 and not target.exists()


def test_all_planned_material_is_original_fixture_with_real_work_parameters():
    for stage,concurrency in enumerate(STAGES,1):
        for i in range(concurrency):
            value=WorkInput.model_validate(chapter_input(CASES[i%len(CASES)],stage,i))
            assert value.content_type=='novel' and value.words_per_chapter==2000 and value.units==2
            assert value.novel_settings.perspective=='third_limited'
            assert value.premise and value.characters and value.outline


def test_confirmation_is_only_five_new_requests(tmp_path):
    result=subprocess.run([sys.executable,str(SCRIPT),'--report-dir',str(tmp_path/'confirm'),'--confirm-five'],text=True,capture_output=True,check=True)
    plan=json.loads(result.stdout)
    assert plan['stages']==[5] and plan['maximum_paid_jobs']==5 and plan['production_cap_if_all_pass']==5
