// Preservar o nome de um item depois que ele é excluído.
//
// O histórico de cliques sobrevive à exclusão (as tabelas de métrica não têm
// chave estrangeira). O que se perdia era o RÓTULO: o painel descobre o nome
// consultando a tabela de origem, e sem a linha o item virava "#4".
//
// Regras:
//  - enquanto a linha de origem existe, ELA manda (renomear renomeia no painel);
//  - quando some, o catálogo dá o nome e o status passa a ser sempre "desativado".

type Meta = { nome: string | null; ativo: boolean }

type Fonte = {
  id: string
  /** ids omitido = todas as linhas (usado na varredura noturna) */
  buscar: (ids?: number[]) => Promise<Map<string, Meta>>
}

// Cada tabela de origem declara UMA vez como nome e status são lidos.
// Painel, gancho de exclusão e varredura usam a mesma definição — o nome nunca
// é derivado de dois jeitos diferentes. Item novo rastreado = uma entrada aqui.
export const FONTES: Fonte[] = [
  // { id: 'banner', buscar: async (ids) => ... },
  // { id: 'popup',  buscar: async (ids) => ... },
]

// Três caminhos alimentam o catálogo, pra nenhuma forma de excluir escapar:

// 1) Gancho logo ANTES de cada DELETE feito pela aplicação.
//    Best-effort: falhar aqui nunca pode impedir a exclusão.
export async function preservarAntesDeExcluir(fonte: Fonte, id: number) {
  try {
    const meta = (await fonte.buscar([id])).get(String(id))
    if (meta) await guardar(fonte.id, new Map([[String(id), meta]]), { excluido: true })
  } catch (err) {
    console.error(`não guardou o nome de ${fonte.id}:${id}`, err)
  }
}

// 2) Leitura do painel: o que existe agora fica guardado pra quando deixar de existir.
export async function resolver(fonte: Fonte, idsVistos: number[]) {
  const vivos = await fonte.buscar(idsVistos)
  await guardar(fonte.id, vivos)

  const sumidos = idsVistos.map(String).filter((id) => !vivos.has(id))
  const guardados = await lerDoCatalogo(fonte.id, sumidos)

  const resultado = new Map(vivos)
  for (const id of sumidos) {
    // Sem nada no catálogo aparece como "#id" — mas continua desativado.
    resultado.set(id, { nome: guardados.get(id) ?? null, ativo: false })
  }
  return resultado
}

// 3) Varredura noturna: espelha tudo que está vivo e marca como excluído o que
//    sumiu da origem. Cobre DELETE feito direto no banco e itens apagados em
//    sistemas de terceiros, onde não existe onde colocar um gancho.
export async function sincronizar() {
  for (const fonte of FONTES) {
    const vivos = await fonte.buscar()
    await guardar(fonte.id, vivos)
    await marcarExcluidosQueSumiram(fonte.id, new Set(vivos.keys()))
  }
}

// Persistência (upsert). COALESCE mantém o nome antigo quando o novo vem vazio:
// apagar o texto de um botão não deve apagar o único rótulo que restava.
declare function guardar(fonte: string, metas: Map<string, Meta>, opcoes?: { excluido?: boolean }): Promise<void>
declare function lerDoCatalogo(fonte: string, ids: string[]): Promise<Map<string, string | null>>
declare function marcarExcluidosQueSumiram(fonte: string, vivos: Set<string>): Promise<void>
