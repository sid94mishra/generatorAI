#!/bin/zsh
# batch.sh <label> <model> <harness> <scenarios...> — runs scenarios one after another, verifying each.
cd "$(dirname $0)/.."
label=$1 model=$2 harness=$3; shift 3
for s in "$@"; do
  # Each task starts from the same state: test apps closed (their documents are test output only).
  for a in TextEdit Numbers Pages Keynote Grapher Preview "Script Editor" Freeform Calculator "Microsoft Word" Dictionary; do pkill -x "$a"; done; sleep 2
  case $s in
    S1) rm -rf cu-out/groceries.rtf ;;
    S2) cp cu/fixtures/draft.txt cu-out/draft.txt ;;
    S3) rm -rf cu-out/budget.csv ;;
    S4) rm -rf cu-out/sales.pdf cu-out/sales-page1.png ;;
    S5) rm -rf cu-out/flow.pdf cu-out/flow-page1.png ;;
    S6) rm -rf cu-out/report.docx ;;
    S8) rm -rf cu-out/fruit-sorted.csv; cp cu/fixtures/fruit.txt cu-out/fruit.txt ;;
    S9) rm -rf cu-out/calc-report.txt ;;
    S10) rm -rf cu-out/q3-review.pdf cu-out/q3-page1.png ;;
    H1) rm -rf cu-out/offsite.docx ;;
    H2) rm -rf cu-out/sine.pdf cu-out/sine-page1.png ;;
    H3) rm -rf cu-out/badge-rotated.jpg; cp cu/fixtures/badge.png cu-out/badge.png ;;
    H4) rm -rf cu-out/answer.applescript ;;
    G1) cp cu/fixtures/style-notes.txt cu-out/style-notes.txt ;;
    G4) rm -rf cu-out/hello.py ;;
    G5) rm -rf cu-out/badge.pdf; cp cu/fixtures/badge.png cu-out/badge.png ;;
    G6) rm -rf cu-out/roadmap.pdf cu-out/roadmap-page1.png ;;
  esac
  echo "=== $label $s"
  node cu/cu-run.mjs $s $model $harness $label 2>&1 | tail -2
  python3 -I cu/cu_verify.py $s
done
echo BATCH-DONE
