// Coletor de métricas (versão didática, sem dependências).
//
// Três ideias que fazem o dado ser confiável:
//  1. tempo engajado: o relógio só corre com a aba visível;
//  2. impressão de verdade: 1 s contínuo com metade do elemento na tela;
//  3. envio que sobrevive ao fechamento da aba (sendBeacon).

const fila = []
let engajadoMs = 0
let ultimoVisivel = Date.now()

const pausar = () => {
  if (!ultimoVisivel) return
  engajadoMs += Date.now() - ultimoVisivel
  ultimoVisivel = 0
}
const retomar = () => { if (!ultimoVisivel) ultimoVisivel = Date.now() }

// Aba esquecida aberta não vira "retenção": esconder a aba pausa o relógio.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pausar(); enviar(true) } else retomar()
})

addEventListener('pagehide', () => {
  pausar()
  fila.push({ tipo: 'fim_de_sessao', engajado_s: Math.round(engajadoMs / 1000) })
  enviar(true)
})

// text/plain evita o preflight de CORS ("simple request"), então o POST sai
// mesmo quando a resposta não traz cabeçalho de CORS. O servidor precisa de um
// parser para esse content-type — sem ele o lote chega como string e é descartado.
function enviar(usarBeacon) {
  if (!fila.length) return
  const corpo = JSON.stringify({ eventos: fila.splice(0) })

  if (usarBeacon && navigator.sendBeacon) {
    navigator.sendBeacon('/api/coleta', new Blob([corpo], { type: 'text/plain;charset=UTF-8' }))
    return
  }
  fetch('/api/coleta', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: corpo,
    keepalive: true,
  }).catch(() => {}) // tracking nunca pode quebrar a página
}

// Impressão: passar rolando por um card não conta como "foi visto".
const vistos = new Set()
const pendentes = new Map()

const observador = new IntersectionObserver((entradas) => {
  for (const { target, isIntersecting } of entradas) {
    const chave = target.dataset.view
    if (!isIntersecting) { clearTimeout(pendentes.get(chave)); pendentes.delete(chave); continue }
    if (vistos.has(chave) || pendentes.has(chave)) continue

    pendentes.set(chave, setTimeout(() => {
      pendentes.delete(chave)
      vistos.add(chave)
      observador.unobserve(target)
      fila.push({ tipo: 'impressao', item: chave })
    }, 1000))
  }
}, { threshold: 0.5 })

document.querySelectorAll('[data-view]').forEach((el) => observador.observe(el))
