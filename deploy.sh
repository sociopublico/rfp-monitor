#/bin/bash
sshpass ssh -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519 root@159.223.193.172 "cd /traefik/rfp && ls"

