# Terminal Sessions Are Transport Agnostic

The system models an already prepared Terminal Session, not an SSH, bastion, container, or server connection. Users establish any required connection inside the terminal before invoking the Agent, which keeps the Agent independent of connection topology but means it cannot rely on transport metadata to identify or recover the remote environment.
