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
CapDent sends data to backend and service providers over secure network connections.

### Do you provide a way for users to request that their data is deleted?
Yes.

In-app path:
More > Legal & Account > Delete Account & Data

Web URL:
https://capdent.in/delete-account/

### Does your app share user data with third parties?
Review in Play Console against Google's current definition of "sharing" before submission.

CapDent uses service providers including Supabase, Firebase Analytics, Google Play Billing and notification infrastructure for app functionality, analytics, account management, payments and security. Data is not sold and is not used for third-party advertising by CapDent. Service-provider processing may qualify for exclusions from "sharing" under Google Play's Data Safety definitions when the applicable conditions are met.

## Data types to declare as collected

### Personal info

1. Name
Collected: Yes
Shared: Review under service-provider rules
Purpose: App functionality, Account management
Required/Optional: Required where used for clinic/staff/patient records

2. Email address
Collected: Yes
Shared: Review under service-provider rules
Purpose: App functionality, Account management, Developer communications
Required/Optional: Required for login/account support

3. User IDs
Collected: Yes
Shared: Review under service-provider rules
Purpose: App functionality, Account management, Fraud prevention/security/compliance
Required/Optional: Required

4. Phone number
Collected: Yes
Shared: Review under service-provider rules
Purpose: App functionality
Required/Optional: Required/optional depending on clinic workflow, used for patient contact and reminders

5. Other info
Collected: Yes
Shared: Review under service-provider rules
Purpose: App functionality
Examples: age, role, clinic details, staff role details
Required/Optional: Required/optional depending on workflow

### Health and fitness

1. Health info
Collected: Yes
Shared: Review under service-provider rules
Purpose: App functionality
Examples: medical history, dental complaints, visit details, prescription details, X-ray related records, treatment/follow-up records
Required/Optional: Required/optional depending on clinic workflow

### Photos and videos

1. Photos
Collected: Yes
Shared: Review under service-provider rules
Purpose: App functionality
Examples: prescription photos, X-ray photos, dental photos, before/after photos
Required/Optional: Optional

### Files and docs

1. Files and docs
Collected: Yes
Shared: Review under service-provider rules
Purpose: App functionality
Examples: prescription PDFs, X-ray files, uploaded patient/clinic documents
Required/Optional: Optional

### Financial info

1. Purchase history
Collected: Yes
Shared: Review under service-provider rules
Purpose: App functionality
Examples: subscription purchase history and clinic billing/payment records
Required/Optional: Required/optional depending on billing workflow

2. Other financial info
Collected: Yes
Shared: Review under service-provider rules
Purpose: App functionality
Examples: pending amount, paid amount, revenue totals, clinic payment records
Required/Optional: Required/optional depending on billing workflow

### App activity

1. Other user-generated content
Collected: Yes
Shared: Review under service-provider rules
Purpose: App functionality
Examples: visit notes, treatment entries, reminders, appointment notes, clinic workflow records
Required/Optional: Required/optional depending on workflow

2. App interactions / other actions
Collected: Yes
Shared: Review under service-provider rules
Purpose: App functionality, Analytics, Fraud prevention/security/compliance
Examples: screen/app interactions measured by Firebase Analytics, check-in actions, completed visits, staff actions, upload actions, payment collection actions
Required/Optional: Required/optional depending on workflow

### App info and performance

Collected: Yes for the V28 production build because Firebase Analytics is enabled.
Shared: Review under service-provider rules
Purpose: Analytics, app functionality and release-quality monitoring as applicable

### Device or other IDs

Collected: Potentially Yes through Firebase installation/app-instance identifiers and related SDK-generated identifiers used for analytics or service operation. Advertising ID permission is explicitly blocked by the Android configuration.
Shared: Review under service-provider rules
Purpose: Analytics, app functionality, fraud prevention/security/compliance as applicable

## Data types to answer No unless added later

Location:
No.

Messages:
No.

Audio files:
No.

Calendar:
No, because CapDent stores appointments inside the app, not the user's device calendar.

Contacts:
No, unless the app imports contacts from the phone contact book.

Web browsing:
No.

## Purposes to select where applicable

- App functionality
- Account management
- Analytics
- Fraud prevention, security, and compliance
- Developer communications, only for email/support/account communication

Do not select unless added later:

- Advertising or marketing
- Personalization

## V28 configuration notes

1. Production enables Firebase Analytics through EXPO_PUBLIC_ENABLE_FIREBASE_ANALYTICS=true.
2. Android blocks com.google.android.gms.permission.AD_ID, so CapDent should not request the Android advertising-ID permission.
3. Re-check the final generated AAB/SDK behavior and Google Play's current Data Safety definitions before submission.
4. If Crashlytics, Performance Monitoring, Sentry, ads, marketing SDKs, or additional analytics providers are enabled later, update this document and the Play Console form before release.

## Notes before submission

1. If Google asks whether data is processed ephemerally, answer No for core CapDent records because clinic data is stored.
2. If Google asks whether users can request data deletion, answer Yes.
3. Account/login data is required. Prescription photos, X-rays, PDFs, and some clinic workflow details are optional because clinics upload them only when needed.
4. Confirm the final Play Console Data Safety selections against the exact production AAB and current Google definitions immediately before submission.
