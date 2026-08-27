# CapDent Play Console Data Safety Draft

App name: CapDent
Package: com.dms.clinic

Privacy Policy URL:
https://capdent.in/privacy/

Delete Account URL:
https://capdent.in/delete-account/

Terms URL:
https://capdent.in/terms/

## Main Data Safety answers

### Does your app collect or share any of the required user data types?
Yes.

### Is all user data collected by your app encrypted in transit?
Yes.

Reason:
CapDent sends app and clinic data to backend/service providers over secure network connections.

### Do you provide a way for users to request that their data is deleted?
Yes.

In-app path:
More > Legal & Account > Delete Account & Data

Web URL:
https://capdent.in/delete-account/

### Does your app share user data with third parties?
Review this answer against the Play Console definition before submission.

Current implementation notes:
- CapDent does not sell patient or clinic data and does not use patient clinical records for advertising.
- CapDent uses service providers for app functionality, authentication, storage, Google Play billing, notifications, and approved analytics.
- Firebase Analytics is enabled for Play Internal and Production release profiles.
- Advertising storage, advertising user data, advertising personalization, and Android Advertising ID access are disabled in CapDent's configuration.
- If Crashlytics or any additional analytics/diagnostic SDK is added before release, re-review this document and the Play Console form before submission.

## Data types to declare as collected

### Personal info

1. Name
Collected: Yes
Shared: Review service-provider handling against Play Console definitions
Purpose: App functionality, Account management
Required/Optional: Required where used for clinic/staff/patient records

2. Email address
Collected: Yes
Shared: Review service-provider handling against Play Console definitions
Purpose: App functionality, Account management, Developer communications
Required/Optional: Required for login/account support

3. User IDs
Collected: Yes
Shared: Review service-provider handling against Play Console definitions
Purpose: App functionality, Account management, Fraud prevention/security/compliance
Required/Optional: Required

4. Phone number
Collected: Yes
Shared: Review service-provider handling against Play Console definitions
Purpose: App functionality
Required/Optional: Required/optional depending on clinic workflow, used for patient contact and reminders

5. Other info
Collected: Yes
Shared: Review service-provider handling against Play Console definitions
Purpose: App functionality
Examples: age, gender, role, clinic details, staff role details
Required/Optional: Required/optional depending on workflow

### Health and fitness

1. Health info
Collected: Yes
Shared: Review service-provider handling against Play Console definitions
Purpose: App functionality
Examples: medical history, dental complaints, visit details, dental chart entries, prescription details, X-ray related records, treatment/follow-up records
Required/Optional: Required/optional depending on clinic workflow

### Photos and videos

1. Photos
Collected: Yes
Shared: Review service-provider handling against Play Console definitions
Purpose: App functionality
Examples: patient photos, prescription photos, X-ray photos, dental photos, before/after photos
Required/Optional: Optional

### Files and docs

1. Files and docs
Collected: Yes
Shared: Review service-provider handling against Play Console definitions
Purpose: App functionality
Examples: prescription PDFs, X-ray files, uploaded patient/clinic documents
Required/Optional: Optional

### Financial info

1. Purchase history
Collected: Yes
Shared: Review Google Play billing/service-provider handling against Play Console definitions
Purpose: App functionality
Examples: Google Play subscription state and clinic payment records
Required/Optional: Required/optional depending on billing workflow

2. Other financial info
Collected: Yes
Shared: Review service-provider handling against Play Console definitions
Purpose: App functionality
Examples: OP fee, treatment charges, pending amount, paid amount, invoice/payment history, revenue totals
Required/Optional: Required/optional depending on billing workflow

### App activity

1. App interactions / other actions
Collected: Yes
Shared: Review Firebase Analytics handling against Play Console definitions
Purpose: Analytics, App functionality, Fraud prevention/security/compliance where applicable
Examples: coarse screen views, login outcome categories, plan views, quota states, notification-health events, owner-review categories, patient-registration completion flags, and other approved analytics events
Required/Optional: Collected in Play Internal and Production release profiles while analytics is enabled

2. Other user-generated content
Collected: Yes
Shared: Review service-provider handling against Play Console definitions
Purpose: App functionality
Examples: visit notes, treatment entries, reminders, appointment notes, clinic workflow records
Required/Optional: Required/optional depending on workflow

### Device or other IDs

Collected: Yes for Firebase-related installation/app measurement identifiers where generated by the Firebase SDK stack.
Shared: Review Firebase's current Play Data Safety guidance against the Play Console definition
Purpose: Analytics, App functionality/security as applicable
Notes:
- CapDent blocks the Android Advertising ID permission.
- CapDent does not deliberately place patient, clinic, purchase-token, or payment identifiers into its custom Firebase Analytics event schema.
- Firebase SDKs may generate installation identifiers and collect app/device metadata required to provide their services; use Google's current Firebase Play Data Disclosure documentation when completing the Play Console form.

## Data types currently expected to answer No unless another feature/SDK changes before release

Location:
No device location permission or location feature is used.

Messages:
No device SMS/message content collection.

Audio files:
No. RECORD_AUDIO is blocked.

Calendar:
No device calendar access. CapDent appointments are stored inside the service.

Contacts:
No device contacts import/access.

Web browsing:
No browsing-history collection.

Advertising ID:
No. com.google.android.gms.permission.AD_ID is explicitly blocked.

Crash logs / diagnostics through Firebase Crashlytics:
Not yet. Crashlytics is not installed at the time of this V27 draft. If it is added before RC, update this document and the Play Console disclosures before release.

## Purposes to select where applicable

- App functionality
- Account management
- Fraud prevention, security, and compliance
- Developer communications, only for email/support/account communication
- Analytics, for Firebase Analytics data collected in enabled release profiles

Do not select unless a future implementation requires it:

- Advertising or marketing
- Personalized advertising

## Analytics privacy implementation notes

CapDent's custom Firebase Analytics schema is intentionally coarse. It is designed not to send:
- patient name, phone, email, or patient ID
- diagnosis or treatment notes
- raw clinic ID or clinic name
- Google Play purchase tokens or order IDs
- PhonePe merchant/payment identifiers
- file paths or uploaded clinical content

Advertising-related consent values are disabled in the app configuration.

## Notes before submission

1. Reconcile this document with the exact Play Console form and the current Firebase Android data-disclosure page at release time; SDK behavior and Play definitions can change.
2. If Google asks whether core CapDent clinic data is processed ephemerally, answer No because clinic records are stored.
3. If Google asks whether users can request data deletion, answer Yes and use https://capdent.in/delete-account/.
4. Account/login data is required. Patient photos, prescriptions, X-rays, PDFs, and some clinic workflow details are optional depending on clinic use.
5. Firebase Analytics is now part of V27 Play Internal/Production, so App activity/Analytics and applicable Firebase identifiers must not be omitted from the release disclosure.
6. If Firebase Crashlytics, another analytics SDK, advertising SDK, marketing SDK, or a new payment/identity provider is enabled before release, review the Privacy Policy and Play Data Safety form again before submission.
