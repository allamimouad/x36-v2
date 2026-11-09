/**
 * This feature's single point of contact with the shared UI package.
 *
 * Only what the feature actually uses is re-exported: a name listed here has to exist in
 * the real package, so anything unused is a compile error waiting to happen for no
 * benefit. Application-wide wiring, such as the tokens the popup service itself needs,
 * belongs to whoever bootstraps the application, not here.
 *
 * Re-exporting does not change identity: `PopupService` is still the same class, so a
 * `{ provide: … }` entry written against this name matches the one the application
 * provides.
 */
export { PopupService, TRACE_ID_HEADER } from 'ibportal-web-ui-commons';
