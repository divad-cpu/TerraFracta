"""Fixed internal review child; startup comes only from inherited custody."""
import sys
from workers.closed_pair_channel import _json


def main():
    if sys.argv[1:]:raise ValueError('Fixed internal review child accepts no arguments')
    raw=sys.stdin.buffer.read(4097)
    if not 1<=len(raw)<=4096:raise ValueError('Fixed custody startup unavailable')
    from scripts.rehearse_correction_review_display import current_candidate_pins
    from workers.invented_review_custody import ReviewWorkerCustody
    custody=ReviewWorkerCustody(_json(raw),current_candidate_pins())
    try:
        from scripts.check_invented_correction_review import main as review
        return review(custody=custody)
    finally:custody.close()


if __name__=='__main__':raise SystemExit(main())
