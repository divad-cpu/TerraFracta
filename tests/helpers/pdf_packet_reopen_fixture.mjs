import { createHash } from 'node:crypto';
import { manualPdfReport } from './pdf_inspection_fixture.mjs';
// Manual supplied assertions only, not actual parser/packet/reopening proof.
export const inspectionWireSha = report => createHash('sha256').update(JSON.stringify(report)+'\n','utf8').digest('hex');
export function manualPdfPacketReopenReport(inspection_report=manualPdfReport()) {
 return { schema_version:1,kind:'private_pdf_packet_reopen_report',scope:'supplied_unverified_pdf_packet_rederivation_only',
  packet_sha256:'b'.repeat(64),inspection_sha256:inspectionWireSha(inspection_report),derivation_sha256:'c'.repeat(64),
  recorded_observed_at:inspection_report.observed_at,reopened_at:'2026-10-18T08:00:01.000001Z',inspection_report };
}
// Exact pure Python _encode wire expectations on invented schema records.
// Only retained_actual reuses an actual prior worker record; mutations are manual.
export const pythonWireVectors = [
  {
    "label": "retained_actual",
    "item_key": "invented-report",
    "text": "Invented native paragraph.",
    "sha256": "66360918b064759ed5995e8cbcc4cda6f10ee80dd37f4af42ec4d702aae5961f",
    "bytes": 1149
  },
  {
    "label": "quotes_slashes",
    "item_key": "quoted-\"\\-é",
    "text": "\"quoted\" \\ / text",
    "sha256": "acc05e1f721a6859fc8ec267722f18a3dbc52d7c2c14cc8e7e9c6c35c5de2f16",
    "bytes": 1142
  },
  {
    "label": "supplementary_combined",
    "item_key": "Unicode-😀",
    "text": "Å é 😀 𐐀",
    "sha256": "4b0f26eb4ff2cd5cfd31741fefa34c88372ee27442a881cf6571c151e3068f2a",
    "bytes": 1136
  },
  {
    "label": "line_separators",
    "item_key": "middle inside",
    "text": "Line paragraph end",
    "sha256": "95c130360f489e4bd05e0ffa2848df80af531241d63aecd46d907245b26e8bdf",
    "bytes": 1145
  },
  {
    "label": "allowed_controls",
    "item_key": "controls",
    "text": "\ttext\n\r﻿",
    "sha256": "49191b915dfbb430e2a9a6d6f29473cd3f0f1c503a85e3802c6b5f9b8610d88d",
    "bytes": 1131
  },
  {
    "label": "del_c1",
    "item_key": "middleinside",
    "text": "",
    "sha256": "80088336b3cf99699526485fb4152575a17a0eee20834f5722a13acdc095942e",
    "bytes": 1125
  }
];
