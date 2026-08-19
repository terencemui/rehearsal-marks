/**
 * Portability — the user's work leaving the browser and coming back intact.
 * Outbound: full-project zips and label-set-only JSON. Inbound: zip imports
 * that can only ever create, and label-set imports gated on recording
 * identity. Built on the domain's versioned project-file format.
 */
export { exportLabelSetJson, exportProjectZip, sanitizeDownloadName } from './export';
export { importLabelSet, importProjectZip, uniqueProjectName } from './import';
export type {
  LabelSetImportOutcome,
  ProjectImportDependencies,
  ProjectImportOutcome,
} from './import';
