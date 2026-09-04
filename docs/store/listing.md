# App Store listing — Practice Partner

Everything App Store Connect asks for on the first submission, ready to paste.
The screenshots beside this file are the ones to upload (6.9" iPhone and 13"
iPad, five each, in the numbered order). `npm run store:shots` regenerates them.

## App record (New App)

| Field | Value |
|---|---|
| Platform | iOS (covers iPhone and iPad) |
| Name | Practice Partner |
| Primary language | English (U.S.) |
| Bundle ID | com.iankaroly.practicepartner |
| SKU | practicepartner |
| User access | Full Access |

## Version information

**Subtitle** (30 max)

    Hear what you played

**Promotional text** (170 max)

    Play, and see every note: which ran sharp or flat, where the tempo drifted, and what has improved since last week. Nothing leaves your device.

**Description**

    Practice Partner listens while you play and shows you what you played.

    Record a take on any instrument, or sing one, and the app draws it out note by note: the pitch of each one, how far it sat from centre, and where the pulse pushed or dragged. Photograph the page you are playing from and the take is marked straight onto the music, so a sharp F is a ring on the F that was sharp.

    WHAT IS IN IT

    • Tuner: a fast, steady chromatic tuner for any instrument or voice, with the A adjustable from 400 to 450 Hz.
    • Record: a count-in, a take, and a review of every note in it. Takes are kept the moment they finish.
    • Score: photograph or import your part, read it on screen with half-page turns, turn pages hands-free, and annotate it with a pencil or a finger. Transpose an engraved score to any key.
    • Coach: what has improved since the last take, and what has not.
    • Metronome: subdivisions, accents, tempo ramps.
    • Library: every take and every score, in folders and setlists.

    FOR EVERY INSTRUMENT

    Strings, winds, brass, voice, piano: if it plays a pitch, Practice Partner can hear it. Choose your instrument once and the tuner, the ranges and the review fit it.

    NOTHING LEAVES YOUR DEVICE

    There is no account, no server, and no analytics. Recordings, photographs of your music and everything the app works out from them are stored on this device only. After the app has loaded it makes no network requests at all. The app is open source, so that claim can be checked.

**Keywords** (100 max, comma-separated, no spaces after commas)

    tuner,metronome,practice,music,sheet music,intonation,recorder,cello,violin,singing,pitch,score

**Support URL**

    https://github.com/iankaroly/music-companion/issues

**Marketing URL**

    https://practicepartner.vercel.app

**Copyright**

    2026 Ian Karoly

**Version**  1.0

**What's New**  (first version; leave blank or "First release.")

## App Information

| Field | Value |
|---|---|
| Primary category | Music |
| Secondary category | Education |
| Content rights | Does not contain, show, or access third-party content |
| Age rating | Answer "None" to every content question → 4+ |
| Privacy policy URL | https://practicepartner.vercel.app/privacy |

## App Privacy

Choose **"Data Not Collected"** for every category. The app has no account,
no analytics and no network calls after load. Microphone audio and camera
images are processed and stored on the device only, which does not count as
collection.

## Pricing and Availability

Free. All territories.

## App Review Information

| Field | Value |
|---|---|
| Sign-in required | No |
| Contact | your name, phone, and the Apple ID email |

**Notes for the reviewer**

    The app needs the microphone to do anything useful: open the Tuner tab and play or sing a note and the needle moves. The Record tab counts in, records a take, and shows every note of it. The camera is used only on the Score tab, to photograph a page of sheet music. No account, no server; the app makes no network requests after it has loaded.

## Export compliance

`ITSAppUsesNonExemptEncryption` is `false` in Info.plist, so the upload
does not ask. If it ever does: the app uses no encryption beyond the HTTPS the
system provides, which is exempt.

## Uploading a build

    npm run store:upload

Archives the app and uploads it to App Store Connect. Xcode must be signed in
(Xcode → Settings → Accounts) with the Apple ID that holds the Developer
Program membership, and the app record above must already exist. The build
appears under TestFlight a few minutes later, then under the version's
"Build" section for review.
