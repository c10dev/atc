### Added
- CAPTAIN report judge (Jev): when an atc AIRCRAFT's turn ends, the judge family classifies the CAPTAIN's last message (reported done, asks for a decision, stopped mid-work, idle and ready, can't tell). Shadow only (ATC-89, [docs/fleet.md](docs/fleet.md) 8.8).
  - Same switch (`off` sends nothing) and the shared 3-a-minute limit. Only `ATCC` AIRCRAFT are read, and the check comes before any read. At most 1,500 characters go out with paths, URLs, e-mail addresses and tokens masked; the message is never stored (`sent: {chars}`).
  - `judges.jsonl` lines with `target: "report"`. A chip on the FLEET row, and a `JEV REPORT` line on the card where the SUPERVISOR marks the class right or wrong; the FLEET PLAN panel shows the agreement.
  - "Asks for a decision" at or above 0.7 (`judges.json` `reportDecisionMin`) adds one `info` `report` issue per turn to FLIGHT FOLLOWING (OCC manual: `following.md` row). No health code, DISPATCH or FLEET PLAN change.
