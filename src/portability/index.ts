/**
 * Portability — the user's work leaving the browser and coming back intact.
 * Outbound: full-project zips for uploads, bare project JSON for YouTube
 * (doubling as the community contribution format), and label-set-only JSON.
 * Inbound: zip and JSON imports that can only ever create, and label-set
 * imports gated on recording identity. Built on the domain's versioned
 * project-file format.
 */
export {
  exportLabelSetJson,
  exportProjectJson,
  exportProjectZip,
  projectFileFromRecord,
  sanitizeDownloadName,
} from './export';
export { importLabelSet, importProjectJson, importProjectZip, uniqueProjectName } from './import';
export type {
  LabelSetImportOutcome,
  ProjectImportDependencies,
  ProjectImportOutcome,
} from './import';
