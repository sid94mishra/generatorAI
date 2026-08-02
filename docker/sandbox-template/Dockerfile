# GeneratorAI Sandbox Template
# Based on Docker's shell sandbox with Node.js and dev tools
FROM docker/sandbox-templates:shell

# The shell template already includes:
#   Ubuntu base, Git, curl, wget, Docker CLI,
#   Node.js, Python, Go, Java, sudo, common build tools

# Install additional tools that workflows commonly need
RUN npm install -g typescript eslint prettier || \
    echo "WARNING: Some dev tools failed to install — sandbox may have limited tooling"

# Default CLI port
ENV COPILOT_CLI_PORT=4321

# Copy convenience entrypoint
COPY entrypoint.sh /usr/local/bin/sandbox-entrypoint.sh
RUN chmod +x /usr/local/bin/sandbox-entrypoint.sh

# Health check for CLI readiness
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=3 \
  CMD bash -c 'echo > /dev/tcp/localhost/${COPILOT_CLI_PORT:-4321}' || exit 1
