#!/usr/bin/env bash
# A release escolhida no pai não pode ser substituída por uma tag homônima do
# fork, e a v1.63.0 que o pai não tem é lida no repositório canônico.
#
#   bash tests/shell/conferir-isolamento-tag-do-upstream.test.sh
#
# Nada aqui toca a rede: gh e curl são dublês, e o git busca clones locais
# (CONFERENCIA_KIT_GIT_MIRROR).
set -uo pipefail
unset $(git rev-parse --local-env-vars)
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t.t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t.t
export GIT_CONFIG_NOSYSTEM=1
EMPTY_GITCONFIG="$(mktemp)"
export GIT_CONFIG_GLOBAL="$EMPTY_GITCONFIG"
: > "$EMPTY_GITCONFIG"

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" "$EMPTY_GITCONFIG"' EXIT

FAILS=0
check() {
  if "${@:2}"; then printf '  ✓ %s\n' "$1"; else printf '  ✗ %s\n' "$1"; FAILS=$((FAILS + 1)); fi
}

# Repositório com um update.sh marcado, numa tag.
repo_com_tag() { # repo_com_tag <dir> <tag> <marcador>
  local dir="$1" tag="$2" marcador="$3"
  mkdir -p "$dir/hostgator-setup-kit"
  printf '%s\n' "$marcador" > "$dir/hostgator-setup-kit/update.sh"
  git -C "$dir" init -q
  git -C "$dir" add -A
  git -C "$dir" commit -q -m "$tag"
  git -C "$dir" tag "$tag"
}

MIRROR="$WORK/mirror"
mkdir -p "$MIRROR/pai" "$MIRROR/melgarafael" "$MIRROR/fork"

repo_com_tag "$WORK/pai-src" v1.2.3 "MARCADOR-UPSTREAM"
git clone -q --bare "$WORK/pai-src" "$MIRROR/pai/crm.git"

repo_com_tag "$WORK/canonico-src" v1.63.0 "MARCADOR-CANONICO"
git clone -q --bare "$WORK/canonico-src" "$MIRROR/melgarafael/DeskcommCRM.git"

# O fork tem a MESMA tag, noutro commit.
FIX="$WORK/fork"
repo_com_tag "$FIX" v1.2.3 "MARCADOR-FORK"
git clone -q --bare "$FIX" "$MIRROR/fork/crm.git"
git -C "$FIX" remote add origin "https://github.com/fork/crm.git"
git -C "$FIX" config url."$MIRROR/fork/crm.git".insteadOf "https://github.com/fork/crm.git"

mkdir -p "$FIX/scripts" "$FIX/hostgator-setup-kit"
cp "$RAIZ/scripts/conferir-isolamento-do-kit.sh" "$FIX/scripts/conferir-isolamento-do-kit.sh"
ln -s "$RAIZ/hostgator-setup-kit/_common.sh" "$FIX/hostgator-setup-kit/_common.sh"

mkdir -p "$WORK/bin"
cat > "$WORK/bin/gh" << 'EOF'
#!/bin/bash
prev=""
repo=""
cmd="${1:-}"
for a in "$@"; do
  if [ "$prev" = "--repo" ]; then repo="$a"; fi
  prev="$a"
done
case "$cmd" in
  api) printf '%s\n' 'pai/crm'; exit 0 ;;
  release)
    if [ "$repo" = "pai/crm" ]; then printf '%s\n' 'v1.2.3'; exit 0; fi
    echo "release not found" >&2
    exit 1
    ;;
esac
exit 1
EOF
cat > "$WORK/bin/curl" << 'EOF'
#!/bin/sh
printf '%s\n' "$*" | grep -q http_code && { printf '404'; exit 0; }
exit 22
EOF
chmod +x "$WORK/bin/gh" "$WORK/bin/curl"

echo '── tag homônima do fork não mascara a release do pai; v1.63.0 vem do canônico'
SAIDA="$(
  cd "$FIX"
  PATH="$WORK/bin:$PATH" \
  GH_TOKEN=teste \
  CONFERENCIA_KIT_GIT_MIRROR="$MIRROR" \
  CONFERENCIA_KIT_SO_CAMINHOS=1 \
  GIT_TERMINAL_PROMPT=0 \
    bash scripts/conferir-isolamento-do-kit.sh container banco
)"
status=$?
check "o script termina ao imprimir os arquivos" test "$status" -eq 0

release="$(printf '%s\n' "$SAIDA" | sed -n '/^---RELEASE---$/,/^---ANTIGO---$/p' | sed '1d;$d')"
antigo="$(printf '%s\n' "$SAIDA" | sed -n '/^---ANTIGO---$/,$p' | sed '1d')"
check "a release v1.2.3 é a do pai" test "$release" = "MARCADOR-UPSTREAM"
check "a release v1.2.3 não é a tag homônima do fork" test "$release" != "MARCADOR-FORK"
check "a v1.63.0 é a do repositório canônico" test "$antigo" = "MARCADOR-CANONICO"
printf '%s\n' "$SAIDA" | grep -q 'release medida: v1.2.3 (upstream pai/crm)'
check "anuncia a release do pai" test $? -eq 0

echo
if [ "$FAILS" -eq 0 ]; then
  echo "OK — a tag do fork não substitui a release do pai"
else
  echo "FALHOU: $FAILS"
  printf '%s\n' "$SAIDA" >&2
  exit 1
fi
