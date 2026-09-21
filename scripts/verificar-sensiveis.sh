#!/usr/bin/env bash
# Verificador de dados sensíveis do portfólio.
#
# Roda em todo commit (hook pre-commit) e deve rodar de novo antes de publicar.
# Falha (exit 1) se achar QUALQUER um destes:
#   1. padrão de segredo (chave de nuvem, chave privada, JWT, webhook, token)
#   2. dado pessoal (CPF formatado, e-mail)
#   3. URL fora da lista de domínios permitidos abaixo
#   4. termo da lista proibida local (.sensiveis.txt, que NÃO vai pro git)
#
# Varre tudo que o git enxerga: arquivos rastreados, staged e novos não ignorados.
# Uso: bash scripts/verificar-sensiveis.sh

set -u
cd "$(git rev-parse --show-toplevel)"

# Domínios que podem aparecer em links. Tudo fora daqui é tratado como vazamento
# em potencial — melhor um falso positivo aqui do que um domínio interno público.
DOMINIOS_OK='github\.com|githubusercontent\.com|mermaid\.js\.org|mermaid\.live|shields\.io|linkedin\.com|w3\.org|example\.com|localhost|127\.0\.0\.1'

LISTA_LOCAL=".sensiveis.txt"
falhas=0
alvos=$(mktemp)
trap 'rm -f "$alvos"' EXIT

# O próprio verificador cita padrões e domínios — não se varre.
git ls-files -co --exclude-standard | grep -v '^scripts/verificar-sensiveis.sh$' > "$alvos"

if [ ! -s "$alvos" ]; then
  echo "verificar-sensiveis: nada pra varrer."
  exit 0
fi

# Recebe a classe e o texto dos achados como ARGUMENTOS, e roda no shell
# principal. Antes recebia o texto por pipe: o contador de falhas mudava dentro
# de um subshell e se perdia, então o script terminava "limpo" com tudo sujo.
reportar() {
  local classe="$1" achados="$2"
  [ -z "$achados" ] && return 0
  echo ""
  echo "✗ $classe"
  echo "$achados" | sed -E 's/^(.{170}).*/\1.../' | sed 's/^/    /'
  falhas=$((falhas + 1))
}

# grep sobre a lista de alvos. $1 = regex; $2 = opção extra (ex.: -i)
varrer() {
  xargs -a "$alvos" -d '\n' grep -nIE ${2:-} -e "$1" 2>/dev/null
}

# 1. Segredos ---------------------------------------------------------------
reportar "Chave de acesso de nuvem" "$(varrer 'AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}')"
reportar "Chave privada"            "$(varrer '-----BEGIN [A-Z ]*PRIVATE KEY-----')"
reportar "Token JWT"                "$(varrer 'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}')"
reportar "URL de webhook"           "$(varrer '/webhook/[0-9a-fA-F-]{20,}|/webhook-test/')"
reportar "Token de API"             "$(varrer '(sk|pk)_(live|test)_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|xox[bp]-[0-9A-Za-z-]{10,}|AIza[0-9A-Za-z_-]{30,}')"
reportar "String de conexão com credencial" \
  "$(varrer '(mysql|postgres(ql)?|mongodb|redis)://[^ "<>]*:[^ "<>]*@')"
reportar "Credencial atribuída em texto" \
  "$(varrer '(password|senha|secret|api[_-]?key|token)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"' ]{8,}["'"'"']' -i)"

# 2. Dado pessoal -----------------------------------------------------------
reportar "CPF formatado"       "$(varrer '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}')"
reportar "Endereço de e-mail"  "$(varrer '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')"

# 3. URLs fora da lista permitida -------------------------------------------
# A classe de caracteres tem o ']' logo depois do '^': escrito em qualquer outro
# lugar ele fecha a classe cedo e a regex nunca casa.
urls_fora=$(xargs -a "$alvos" -d '\n' grep -nIoE 'https?://[^] )>"'"'"']+' 2>/dev/null \
  | grep -vE "https?://([a-zA-Z0-9-]+\.)*($DOMINIOS_OK)([/:?#]|$)")
reportar "URL fora dos domínios permitidos" "$urls_fora"

# 4. Termos proibidos (lista local) -----------------------------------------
if [ -f "$LISTA_LOCAL" ]; then
  while IFS= read -r termo || [ -n "$termo" ]; do
    case "$termo" in ''|'#'*) continue ;; esac
    if [[ "$termo" == w:* ]]; then
      palavra="${termo#w:}"
      achados=$(xargs -a "$alvos" -d '\n' grep -nIiw -F -e "$palavra" 2>/dev/null)
    else
      achados=$(xargs -a "$alvos" -d '\n' grep -nIi -F -e "$termo" 2>/dev/null)
    fi
    reportar "Termo proibido: \"${termo#w:}\"" "$achados"
  done < "$LISTA_LOCAL"
else
  # Sem a lista, a checagem mais importante (nome da empresa, artistas,
  # fornecedores) simplesmente não existe. Melhor bloquear que fingir que passou.
  echo ""
  echo "✗ $LISTA_LOCAL não existe — sem ela nome de empresa, artista e fornecedor passam batido."
  falhas=$((falhas + 1))
fi

echo ""
if [ "$falhas" -gt 0 ]; then
  echo "verificar-sensiveis: $falhas tipo(s) de problema. Nada foi commitado."
  exit 1
fi
echo "verificar-sensiveis: limpo ($(wc -l < "$alvos") arquivos varridos)."
exit 0
