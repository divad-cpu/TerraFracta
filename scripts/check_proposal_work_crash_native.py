"""Fixed combined worker-command/server-crash trial; new owned fixture only."""
from scripts.check_operator_proposal_native import main,BASE
from scripts.fictional_trial_guard import trial_process_lock,cooperative_trial_interrupt

if __name__=='__main__':
    with trial_process_lock(BASE/'lifecycle'),cooperative_trial_interrupt():main(work_database_crash_only=True)
