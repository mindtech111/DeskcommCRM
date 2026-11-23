#!/usr/bin/env bash
# conferir-isolamento-do-kit.sh — roda a conferência de regras de isolamento do
# `hostgator-setup-kit/update.sh` contra um banco que acabou de receber o
# `supabase/baseline.sql` deste checkout (issue #1909).
#
#   bash scripts/conferir-isolamento-do-kit.sh <container> <banco>
#
# Chamado por `scripts/test-db.sh` (job obrigatório `invariants`), depois das
# passadas de install e update.
#
# ## O incidente
#
# O #1578 escreveu `create policy` dentro do corpo de `fn_honorarios_provisionar()`.
# A conferência do `update.sh` lê as regras esperadas do TEXTO do baseline e passou
# a cobrar 8 regras de tabelas que só existem com o módulo instalado: da v1.61.0 à
# v1.63.0 a atualização de quase toda instalação parava com o CRM atrás da página de
# manutenção (#1893, #1897, #1899). Os cinco checks obrigatórios estavam verdes: o
# `test:db` aplicava o baseline, mas ninguém rodava a conferência do kit contra ele.
#
# ## As versões conferidas, e por que não só a deste checkout
#
# 1. a do `update.sh` DESTE checkout — pega conferência nova com defeito;
# 2. a do `update.sh` da ÚLTIMA RELEASE PUBLICADA — pega baseline novo que o script
#    antigo não entende. É ela que roda na VPS: o `update.sh` em execução é o do
#    disco, lido antes do `git checkout` da versão nova;
# 3. fixa, a da v1.63.0: a última cuja conferência cobra toda regra escrita no
#    texto, sem perguntar se a tabela existe. Medido tag a tag: de v1.39.0 a
#    v1.63.0 o awk que monta as regras esperadas é o mesmo (só o `LC_ALL=C` do sort
#    muda, na v1.58.1); a v1.63.1 trouxe o filtro por tabela existente (#1906).
#    Ela representa toda instalação que ainda roda um desses scripts — e a última
#    release sozinha NÃO pegaria o próprio incidente: ela já tem o filtro.
#
# ## Como: o trecho REAL do script, nunca uma cópia
#
# A conferência não é função chamável — é código corrido dentro do passo do banco.
# Copiá-la para cá envelheceria na primeira mudança dela. O trecho é recortado do
# próprio `update.sh` entre dois marcadores que existem em TODA versão que tem a
# conferência (v1.39.0 em diante, medido tag a tag): o cabeçalho
# `E AS REGRAS DE ISOLAMENTO SÃO CONFERIDAS` e a PRIMEIRA atribuição de `faltando`.
#
# O recorte para na primeira comparação de propósito: o que vem depois é a
# RECRIAÇÃO das regras que faltam, e ela curaria em silêncio um banco recém-
# instalado com regra ausente. Aqui o banco acabou de receber o baseline inteiro —
# qualquer ausência na primeira comparação é defeito, do baseline ou do script.
#
# O acesso ao banco é a única peça trocada: `pg_container` (no kit, `docker run
# postgres:17-alpine psql <url> …`) vira `docker exec` no container do test:db,
# com os MESMOS argumentos de psql que o trecho passou.
#
# ## Qual é a última release
#
# `CONFERENCIA_KIT_RELEASE=vX.Y.Z` escolhe à mão (é o botão para provar contra uma
# release anterior). Sem ele, nesta ordem:
#
# 1. a última release PUBLICADA do origin — `gh release view` quando há
#    `GH_TOKEN` (o CI: a API anônima tem teto de 60 consultas/hora por IP, e o
#    executor próprio é um IP só); senão `ultima_release_estavel` do kit
#    (`/releases/latest`). É o `update.sh` que está no disco de quem atualiza.
# 2. o origin respondeu 404 (fork sem release nenhuma — não é "API fora"): a
#    última release do repositório-pai (`.parent.full_name`). Se a API não disser
#    quem é o pai, ou o pai também não tiver release, o fallback fixo é
#    `melgarafael/DeskcommCRM`. A tag, quando o origin não a tem, é buscada nesse
#    mesmo repositório — inclusive a v1.63.0, que um fork pode nunca ter recebido.
# 3. o upstream também não respondeu: a tag semver mais recente que ESTE git já
#    tem (local ou `origin`). As `v1.85.0-mt.*` entram aqui.
#
# Tag não é release publicada. O degrau 3 só existe DEPOIS de o origin ter
# confirmado 404. API fora no repositório que publica continua REPROVANDO — cair
# na maior tag reintroduziria o defeito que `ultima_release_estavel` existe para
# matar (cabeçalho dela em `_common.sh`). Essa função do kit não muda: quem
# instala numa VPS continua sem adivinhar versão.
#
# Sem resposta, REPROVA — gate que pula em silêncio não é gate. O script acha a
# release sozinho; `CONFERENCIA_KIT_RELEASE` no CI não é necessário.
set -euo pipefail

CONTAINER="${1:?uso: $0 <container> <banco>}"
BANCO="${2:?uso: $0 <container> <banco>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KIT="$ROOT/hostgator-setup-kit"
UPSTREAM_PADRAO="melgarafael/DeskcommCRM"
UPSTREAM_JA_RESOLVIDO=0
UPSTREAM_REMOTO_RESOLVIDO=""

slug_github() { # slug_github <url> — owner/repo, sem credencial e sem .git
  local origem="$1" slug=""
  [ -n "$origem" ] || return 0
  origem="$(printf '%s' "$origem" | sed -E 's#^(https?://)[^/@]+@#\1#')"
  case "$origem" in
    https://github.com/*|http://github.com/*|git@github.com:*|ssh://git@github.com/*)
      slug="$(printf '%s' "$origem" \
        | sed -E 's#^ssh://git@github\.com/#https://github.com/#; s#^git@github\.com:#https://github.com/#; s#\.git$##; s#^https?://[^/]+/##')"
      ;;
    *) return 0 ;;
  esac
  slug="${slug%/}"
  case "$slug" in
    [A-Za-z0-9_.-]*/[A-Za-z0-9_.-]*) printf '%s\n' "$slug" ;;
  esac
}

slug_do_origin() {
  slug_github "$(git -C "$ROOT" config --get remote.origin.url 2>/dev/null || true)"
}

gh_pronto() {
  command -v gh >/dev/null 2>&1 || return 1
  if [ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ]; then
    return 0
  fi
  gh auth status >/dev/null 2>&1
}

http_da_latest() { # http_da_latest <owner/repo> — código HTTP de /releases/latest
  local repo="$1" codigo
  local -a hdr=()
  case "$repo" in
    [A-Za-z0-9_.-]*/[A-Za-z0-9_.-]*) ;;
    *) printf '000\n'; return 0 ;;
  esac
  if [ -n "${GH_TOKEN:-}" ]; then
    hdr=(-H "Authorization: Bearer ${GH_TOKEN}")
  elif [ -n "${GITHUB_TOKEN:-}" ]; then
    hdr=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  fi
  if codigo="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
      -H 'Accept: application/vnd.github+json' \
      "${hdr[@]}" \
      "https://api.github.com/repos/${repo}/releases/latest" 2>/dev/null)"; then
    printf '%s\n' "$codigo"
  else
    printf '000\n'
  fi
}

release_publicada_de() { # release_publicada_de <owner/repo> — tag, ou vazio
  local repo="$1" tag="" codigo="" corpo=""
  local -a hdr=()
  case "$repo" in
    [A-Za-z0-9_.-]*/[A-Za-z0-9_.-]*) ;;
    *) return 0 ;;
  esac
  if gh_pronto; then
    tag="$(gh release view --repo "$repo" --json tagName -q .tagName 2>/dev/null || true)"
  fi
  if [ -z "$tag" ]; then
    corpo="$(mktemp "${TMPDIR:-/tmp}/deskcomm-release.XXXXXX")"
    if [ -n "${GH_TOKEN:-}" ]; then
      hdr=(-H "Authorization: Bearer ${GH_TOKEN}")
    elif [ -n "${GITHUB_TOKEN:-}" ]; then
      hdr=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
    fi
    if codigo="$(curl -sS -o "$corpo" -w '%{http_code}' --max-time 20 \
        -H 'Accept: application/vnd.github+json' \
        "${hdr[@]}" \
        "https://api.github.com/repos/${repo}/releases/latest" 2>/dev/null)" \
      && [ "$codigo" = "200" ]; then
      tag="$(sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$corpo" | head -1)"
    fi
    rm -f "$corpo"
  fi
  case "$tag" in
    v[0-9]*) printf '%s\n' "$tag" ;;
  esac
}

parent_do_fork() { # .parent.full_name, ou vazio quando não é fork / a API não responde
  local slug parent=""
  slug="$(slug_do_origin)"
  [ -n "$slug" ] || return 0
  if gh_pronto; then
    parent="$(gh api "repos/${slug}" --jq '.parent.full_name // empty' 2>/dev/null || true)"
  elif command -v python3 >/dev/null 2>&1; then
    parent="$(curl -fsSL --max-time 20 -H 'Accept: application/vnd.github+json' \
      "https://api.github.com/repos/${slug}" 2>/dev/null \
      | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    d={}
print(((d.get("parent") or {}).get("full_name") or ""))' || true)"
  fi
  case "$parent" in
    [A-Za-z0-9_.-]*/[A-Za-z0-9_.-]*) printf '%s\n' "$parent" ;;
  esac
}

upstream_efetivo() { # pai, ou o fallback fixo, desde que não seja o próprio origin
  local pai slug
  if [ "$UPSTREAM_JA_RESOLVIDO" = 1 ]; then
    printf '%s\n' "$UPSTREAM_REMOTO_RESOLVIDO"
    return 0
  fi
  pai="$(parent_do_fork)"
  [ -n "$pai" ] || pai="$UPSTREAM_PADRAO"
  slug="$(slug_do_origin)"
  if [ -n "$pai" ] && [ "$pai" != "$slug" ]; then
    UPSTREAM_REMOTO_RESOLVIDO="$pai"
  else
    UPSTREAM_REMOTO_RESOLVIDO=""
  fi
  UPSTREAM_JA_RESOLVIDO=1
  printf '%s\n' "$UPSTREAM_REMOTO_RESOLVIDO"
}

tag_semver_mais_recente() { # maior tag semver deste git (local + origin), ou vazio
  {
    git -C "$ROOT" tag -l 'v[0-9]*'
    git -C "$ROOT" ls-remote --tags origin 'refs/tags/v*' 2>/dev/null \
      | awk '{ sub("^refs/tags/", "", $2); print $2 }' || true
  } | sed 's/\^{}$//' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+)*$' \
    | sort -uV \
    | tail -n 1
}

tag_valida() {
  case "$1" in
    v[0-9]*) ;;
    *) return 1 ;;
  esac
  case "$1" in
    *[!A-Za-z0-9._-]*) return 1 ;;
  esac
}

release="${CONFERENCIA_KIT_RELEASE:-}"
fonte="informada"
origem_http=""
if [ -z "$release" ] && [ -n "${GH_TOKEN:-}" ] && command -v gh >/dev/null 2>&1; then
  release="$(cd "$ROOT" && gh release view --json tagName -q .tagName 2>/dev/null || true)"
  [ -n "$release" ] && fonte="origin"
fi
if [ -z "$release" ]; then
  release="$(cd "$ROOT" && bash -c 'source "$1/_common.sh" >/dev/null 2>&1; ultima_release_estavel' _ "$KIT" || true)"
  [ -n "$release" ] && fonte="origin"
fi
if [ -z "$release" ]; then
  origem_http="$(http_da_latest "$(slug_do_origin)")"
  if [ "$origem_http" = "404" ]; then
    remoto="$(upstream_efetivo)"
    if [ -n "$remoto" ]; then
      release="$(release_publicada_de "$remoto" || true)"
      [ -n "$release" ] && fonte="upstream ${remoto}"
    fi
    # Fork de um fork: o pai existe e também não publica release. O fallback
    # fixo é o repositório de origem do produto.
    if [ -z "$release" ] && [ "$remoto" != "$UPSTREAM_PADRAO" ] \
      && [ "$(slug_do_origin)" != "$UPSTREAM_PADRAO" ]; then
      release="$(release_publicada_de "$UPSTREAM_PADRAO" || true)"
      if [ -n "$release" ]; then
        fonte="upstream ${UPSTREAM_PADRAO}"
        UPSTREAM_REMOTO_RESOLVIDO="$UPSTREAM_PADRAO"
        UPSTREAM_JA_RESOLVIDO=1
      fi
    fi
    if [ -z "$release" ]; then
      release="$(tag_semver_mais_recente || true)"
      [ -n "$release" ] && fonte="tag"
    fi
  fi
fi
if ! tag_valida "${release:-}"; then
  if [ "$origem_http" = "404" ]; then
    echo "FATAL: o origin não tem release publicada, o upstream não respondeu e não há tag semver no git." >&2
  else
    echo "FATAL: não consegui saber qual é a última release publicada (sem rede? API fora?)." >&2
  fi
  echo "       Diga qual com CONFERENCIA_KIT_RELEASE=vX.Y.Z e rode de novo." >&2
  exit 1
fi
echo "==> release medida: $release ($fonte)"

# O arquivo de cada release. No CI o checkout é raso e sem tags: busca só a tag
# no origin, rasa também. Numa árvore completa, busca sem --depth — com ele o
# git marcaria o repositório de quem roda como raso. Tag que o origin não tem
# (fork sem as releases do pai) é lida num clone raso TEMPORÁRIO do upstream:
# o repositório de quem roda não vira raso e não ganha tag nova.
ANTES_DO_FILTRO="v1.63.0"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/deskcomm-update-sh.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

tag_no_clone() { # tag_no_clone <tag> — 0 se a tag está no clone (busca no origin se faltar)
  local tag="$1"
  local -a args
  git -C "$ROOT" rev-parse -q --verify "refs/tags/${tag}^{commit}" >/dev/null 2>&1 && return 0
  args=(fetch -q --no-tags)
  if [ "$(git -C "$ROOT" rev-parse --is-shallow-repository)" = true ]; then
    args+=(--depth=1)
  fi
  args+=(origin "+refs/tags/${tag}:refs/tags/${tag}")
  GIT_TERMINAL_PROMPT=0 git -C "$ROOT" "${args[@]}" >/dev/null 2>&1
}

arquivo_no_upstream() { # arquivo_no_upstream <tag> <dest> — update.sh da tag, no pai
  local tag="$1" dest="$2" remoto dir
  tag_valida "$tag" || return 1
  remoto="$(upstream_efetivo)"
  [ -n "$remoto" ] || return 1
  dir="$TMP/src-${tag}"
  rm -rf "$dir"
  git init -q "$dir"
  GIT_TERMINAL_PROMPT=0 git -C "$dir" fetch -q --depth=1 \
    "https://github.com/${remoto}.git" \
    "+refs/tags/${tag}:refs/tags/${tag}" >/dev/null 2>&1 \
    || return 1
  git -C "$dir" show "${tag}:hostgator-setup-kit/update.sh" > "$dest"
}

update_sh_da() { # update_sh_da <tag> — caminho de uma cópia do update.sh da tag
  # `local a=… b=$a` vê `a` ainda vazio (`set -u` estoura): o local entra em
  # escopo antes das atribuições da mesma linha.
  local tag="$1"
  local dest="$TMP/$tag"
  tag_valida "$tag" || {
    echo "FATAL: tag recusada: ${tag}" >&2
    return 1
  }
  if [ -s "$dest" ]; then
    printf '%s' "$dest"
    return 0
  fi
  if tag_no_clone "$tag"; then
    git -C "$ROOT" show "${tag}:hostgator-setup-kit/update.sh" > "$dest"
  elif arquivo_no_upstream "$tag" "$dest"; then
    :
  else
    echo "FATAL: não achei hostgator-setup-kit/update.sh da tag ${tag} no origin nem no upstream (${UPSTREAM_REMOTO_RESOLVIDO:-$UPSTREAM_PADRAO})." >&2
    return 1
  fi
  if [ ! -s "$dest" ]; then
    echo "FATAL: update.sh da tag ${tag} veio vazio." >&2
    return 1
  fi
  printf '%s' "$dest"
}

# conferir <rótulo> <update.sh> — 0 se nenhuma regra falta, 1 se falta.
conferir() {
  local rotulo="$1" script="$2" trecho
  trecho="$(sed -n '/E AS REGRAS DE ISOLAMENTO SÃO CONFERIDAS/,/^  faltando="\$(/p' "$script")"
  # O recorte TEM de ter achado o começo e o fim. Sem esta guarda, um marcador
  # renomeado devolveria trecho vazio e a conferência "passaria" sem ter rodado.
  if ! printf '%s\n' "$trecho" | grep -q '^ *esperadas="\$(awk' \
     || ! printf '%s\n' "$trecho" | grep -q '^  faltando="\$('; then
    echo "  ✗ $rotulo: não achei a conferência entre os marcadores em $script" >&2
    return 1
  fi
  local saida
  if ! saida="$(
    cd "$ROOT"
    # O kit roda sob `set -euo pipefail` (_common.sh), e o trecho também.
    url_do_schema() { printf 'test-db'; }
    pg_container() {
      while [ $# -gt 0 ] && [ "${1#-}" != "$1" ]; do shift; done
      [ "${2:-}" = psql ] || { echo "pg_container: chamada inesperada: $*" >&2; return 99; }
      shift 3
      docker exec -i "$CONTAINER" psql -U postgres -d "$BANCO" "$@"
    }
    eval "$trecho"
    printf 'declaradas=%s\n' "$(printf '%s\n' "$esperadas" | grep -c . || true)"
    printf '%s\n' "$faltando" | sed '/^$/d; s/^/falta=/'
  )"; then
    echo "  ✗ $rotulo: o trecho da conferência falhou ao rodar" >&2
    return 1
  fi
  local declaradas faltam
  declaradas="$(printf '%s\n' "$saida" | sed -n 's/^declaradas=//p')"
  faltam="$(printf '%s\n' "$saida" | sed -n 's/^falta=//p')"
  if [ -n "$faltam" ]; then
    echo "  ✗ $rotulo: REGRAS DE ISOLAMENTO AUSENTES — a atualização pararia com o CRM fora do ar:" >&2
    printf '%s\n' "$faltam" | sed 's/|/ na tabela /; s/^/      • /' >&2
    return 1
  fi
  # Zero declaradas é o awk que não leu nada — a conferência muda, não a verde.
  if [ "${declaradas:-0}" -eq 0 ]; then
    echo "  ✗ $rotulo: a conferência não declarou regra nenhuma — o instrumento não mediu" >&2
    return 1
  fi
  echo "    ✓ $rotulo: $declaradas regras declaradas, todas no banco"
}

falhas=0
conferir "update.sh deste checkout" "$KIT/update.sh" || falhas=$((falhas + 1))
script_release="$(update_sh_da "$release")" || exit 1
case "$fonte" in
  tag)
    rotulo="update.sh da tag $release (origin sem release e upstream fora do ar)"
    ;;
  upstream*)
    rotulo="update.sh da última release do upstream ($release)"
    ;;
  *)
    rotulo="update.sh da última release ($release)"
    ;;
esac
conferir "$rotulo" "$script_release" || falhas=$((falhas + 1))
if [ "$release" != "$ANTES_DO_FILTRO" ]; then
  script_antigo="$(update_sh_da "$ANTES_DO_FILTRO")" || exit 1
  conferir "update.sh da $ANTES_DO_FILTRO (sem filtro por tabela)" "$script_antigo" || falhas=$((falhas + 1))
fi
[ "$falhas" -eq 0 ] || exit 1
