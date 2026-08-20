# The score pipeline, as one image.
#
# WHAT IS IN IT AND WHAT IS NOT: Audiveris only. oemer is the fallback engine on
# a laptop and it takes about four minutes a page against Audiveris's thirty
# seconds — two hundred times the compute for a page that is usually worse. On
# somebody's own machine that is a fine trade for rescuing a page; on a service
# other people share it is the whole bill. So the image carries Audiveris, and a
# page Audiveris cannot read comes back as a page that could not be read, which
# the pipeline already says plainly.
#
# Built in two stages because the JDK, gradle and the Audiveris sources are
# about a gigabyte and none of them are needed to run it.

# --- build Audiveris ---------------------------------------------------------
FROM eclipse-temurin:26-jdk AS audiveris
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# A shallow clone of the branch that is built and measured on the laptop this
# was developed on. Pinning would be better; the project does not tag often.
RUN git clone --depth 1 https://github.com/Audiveris/audiveris.git /audiveris
WORKDIR /audiveris
RUN ./gradlew --no-daemon --console=plain installDist

# --- the service ------------------------------------------------------------
FROM eclipse-temurin:26-jre

# ghostscript rasterises a PDF page when the book cannot be read whole;
# tesseract is what Audiveris reads the words on the page with; curl fetches the
# language file below.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ghostscript tesseract-ocr curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get purge -y gnupg && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY --from=audiveris /audiveris/app/build/install/app /opt/audiveris

# THE LANGUAGE FILE AUDIVERIS CAN ACTUALLY USE.
#
# It initialises Tesseract in LEGACY mode, and the eng.traineddata a package
# manager installs is the LSTM-only build - Audiveris finds it, fails to load
# it, and logs "Tesseract couldn't load any languages!" while still reading the
# notes. The full file from the tessdata repository is the one that works.
#
# It goes in a folder of our own with TESSDATA_PREFIX pointing at it, because
# that is the first place TesseractOCR.findOcrFolder looks and it is the same
# on every OS. The folder it falls back to is per-platform - on Linux that is
# $HOME/.config/AudiverisLtd/audiveris/tessdata, nothing like the macOS one -
# and an image should not have to guess.
RUN mkdir -p /opt/tessdata \
    && curl -fsSL -o /opt/tessdata/eng.traineddata \
       https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY fixtures ./fixtures

# GDK_SCALE: ON LINUX, AUDIVERIS DIES WITHOUT THIS.
#
# WellKnowns.enableHiDpiScaling runs on Linux only, and asks GTK how big the
# monitor is by loading libgtk-3 through JNA. There is no GTK in a server
# container, so JNA throws UnsatisfiedLinkError - an Error, which sails straight
# through the two `catch (Exception)` blocks around it and takes the process
# with it, exit code 1, before a single note is read. The macOS build never runs
# that code, which is why this only appeared once it was on a real server.
#
# The method returns early if GDK_SCALE is set, so it never reaches GTK. The
# alternative is installing libgtk-3 - a hundred megabytes of desktop toolkit so
# a batch process can ask about a monitor that does not exist.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris \
    JAVA_HOME=/opt/java/openjdk \
    TESSDATA_PREFIX=/opt/tessdata \
    GDK_SCALE=1 \
    SCORE_DATA_DIR=/data \
    OMR_ENGINE=audiveris
EXPOSE 8080
CMD ["node", "src/index.js"]
