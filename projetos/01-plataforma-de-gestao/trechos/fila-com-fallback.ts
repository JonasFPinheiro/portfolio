// Envio de lotes de métricas para uma fila, com degradação segura.
//
// Regra de projeto: a fila é uma proteção pro banco, então ela NUNCA pode ser o
// motivo de a coleta parar nem de o buffer em memória crescer sem teto.
//
// O problema que isto resolve: `fila.add()` espera a conexão com o Redis ficar
// pronta, e o cliente reconecta indefinidamente. Com o Redis fora do ar a
// chamada simplesmente nunca volta (medi mais de 20 s). O lock de gravação nunca
// liberava e o buffer crescia sem limite — exatamente o oposto do que a fila
// deveria garantir.

import type { Queue } from 'bullmq'

type Lote = Record<string, unknown>

const ESPERA_APOS_FALHA_MS = 60_000
let proximaSondagem = 0

const comTeto = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ])

// Devolve a fila só se a conexão JÁ está de pé. É uma checagem, não uma espera.
async function filaPronta(fila: Queue): Promise<Queue | null> {
  // Depois de uma falha, não sonda de novo a cada descarga: cada tentativa custaria
  // os 3 s do teto e só atrasaria a gravação. (Medido: 4 s na 1ª, ~150 ms nas seguintes.)
  if (Date.now() < proximaSondagem) return null

  try {
    const cliente = await comTeto(fila.client, 3_000)
    if (cliente.status === 'ready') return fila
  } catch {
    /* cai no caminho de falha abaixo */
  }

  proximaSondagem = Date.now() + ESPERA_APOS_FALHA_MS
  return null
}

export async function descarregar(
  lote: Lote,
  fila: Queue,
  gravarNoBanco: (l: Lote) => Promise<void>,
): Promise<void> {
  const pronta = await filaPronta(fila)

  // Sem fila: degrada para escrita direta. O tracking perde a proteção, não a coleta.
  if (!pronta) return gravarNoBanco(lote)

  try {
    await comTeto(pronta.add('lote', lote), 5_000)
  } catch {
    // A conexão estava pronta e mesmo assim estourou o tempo: o job PODE ter
    // entrado. Gravar direto agora arriscaria contar em dobro, então esta janela
    // é descartada de propósito — 30 s de dado valem menos que um número inflado.
  }
}
