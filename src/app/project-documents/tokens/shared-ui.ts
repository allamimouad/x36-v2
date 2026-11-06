/**
 * This feature's single point of contact with the shared UI package.
 *
 * Everything here imports the popup service, the trace-id header and the two
 * application-context tokens through this file, so the package's exported names are
 * spelled once rather than in every consumer. Re-exporting does not change identity:
 * `PopupService` is still the same class and the tokens are still the same instances,
 * so a `{ provide: … }` entry written against these names matches the ones the
 * application provides.
 */
export {
    CURRENT_APP_INJECTION_TOKEN as CURRENT_APPLICATION,
    IB_PORTAL_SUPPORT_EMAIL_ADDRESS_INJECTION_TOKEN as SUPPORT_EMAIL_ADDRESS,
    IBPortalTargetApplication as TargetApplication,
    PopupService,
    TRACE_ID_HEADER
} from 'ibportal-web-ui-commons';
