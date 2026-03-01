# 1. Lock the exact version the patch was written for
FROM matrixdotorg/synapse:v1.147.1

# 2. Switch to root to install dependencies and modify system files
USER root
RUN apt-get update && apt-get install -y patch && rm -rf /var/lib/apt/lists/*

# 3. Copy the patch into the container's temporary directory
COPY synapse-zero-flash.patch /tmp/synapse-zero-flash.patch

# 4. Dynamically find the site-packages directory and apply the patch.
# Calling python3 to find the parent directory of the synapse module ensures 
# this step survives internal container OS or Python version upgrades.
RUN SITE_PACKAGES=$(python3 -c "import synapse, os; print(os.path.dirname(os.path.dirname(synapse.__file__)))") && \
    echo "Applying patch in $SITE_PACKAGES" && \
    patch -p1 -d $SITE_PACKAGES < /tmp/synapse-zero-flash.patch

# 5. Revert back to the official unprivileged synapse user (UID 991)
USER 991:991
