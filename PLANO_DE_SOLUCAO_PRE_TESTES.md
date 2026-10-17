# Plano de solução da FUTURA AI até a prontidão para testes

**Objetivo:** deixar a ferramenta estável, coerente e verificável para que primeiro seja submetida a testes internos controlados. A oferta a empresas ocorrerá somente depois da aprovação desses testes. A reformulação do site e a definição de preços ficam para depois; o conteúdo atual do site não é tratado como especificação nem como prova de funcionalidade.

## Registro de execução — 17/10/2026

**Estado: em andamento; não aprovada para teste externo.**

- Linha de base e código do projeto identificados; as mudanças estão sendo verificadas localmente com dados fictícios.
- Importação CSV/TSV: validação de débito/crédito, sinais contábeis, datas, duplicados por centro de custo e atomicidade aprimoradas. O leitor XLSX existente ganhou um teste sintético de aba/cabeçalho/valores; cobertura de exportações reais, mapeamento guiado e prévia ponta a ponta continuam pendentes.
- Movimentações: testes de criação, edição, exclusão, auditoria antes/depois, idempotência de importação e bloqueio de acesso cruzado entre duas empresas passaram.
- Indicadores: telas de movimentação passaram a dizer “resultado do período” e “margem de caixa”. Testes comparam listagem e totais nos filtros de 30, 60, 90 dias e intervalo específico, além de conferir o dashboard de 2026. Casos de transferência, estorno e pendência contábil ainda precisam de definição e teste.
- Previsão: meses sem lançamentos agora são diferenciados de meses com faturamento zero; sem os seis meses preenchidos, o cálculo não infere crescimento e o painel informa cobertura/limitação. O endpoint possui contingência determinística quando Workers AI não está disponível. Foi adicionado backtest móvel de 1 mês à frente: compara a tendência calculada com a média simples dos 6 meses anteriores, mostra erro absoluto médio por receita/despesa e exige meses observados consecutivos. Testes sintéticos cobrem 6 janelas válidas com tendência crescente e exclusão de janelas incompletas; amostras curtas são rotuladas como insuficientes ou pequenas.
- Equipe e informes: correção aplicada para aceitar valores zero nos campos mensais; testes cobrem acesso restrito ao proprietário e isolamento de pessoas/folha entre empresas.
- Administração: novos testes de integração cobrem bloqueio sem sessão administrativa, catálogo de segmentos, criação de empresa e credenciais, validação de perfil/segmento, edição auditada, redefinição de senha com invalidação de sessões, suspensão de usuário e cobrança. Lembrete automático sem provedor de e-mail é bloqueado; envio manual fica explicitamente como rascunho, e os totais de meta e receitas/despesas do projeto são conferidos.
- Notícias: testes sintéticos comprovam seleção diferente para empresa de software e empresa financeira, removem notícia antiga, duplicada e de setor irrelevante, e distinguem indisponibilidade do provedor de uma busca sem resultados. Feed vazio é identificado como link de busca ao vivo, sem ser tratado como notícia publicada. Navegação real para fontes e estabilidade do carrossel ainda precisam de homologação em navegador.
- CI e navegador: workflow do GitHub configurado para rodar `npm run check` em pull requests e pushes; as execuções mais recentes para o commit atual passaram. O Wrangler reconhece as bindings locais, mas encerra com `uv_interface_addresses returned Unknown system error 1`; a prévia local também não ficou acessível ao navegador remoto. A validação visual desktop/celular permanece bloqueada e não foi marcada como concluída.
- Autorização (revisão parcial concluída): as rotas empresariais passam pela sessão; inclusão/edição/exclusão unitária de lançamentos está isolada por empresa; folha, dados salariais, importação da equipe e exclusão em lote são restritos ao perfil proprietário. Novos testes confirmam bloqueio sem sessão em perfil, movimentos, auditoria, DRE, equipe, folha e previsão; perfil financeiro não lê nem altera folha, importa equipe ou apaga movimentos em lote. A revisão completa de cada rota e dos papéis restantes ainda não terminou.
- Verificação local atual: `npm run check` passou, cobrindo DRE, importação CSV/TSV/XLSX sintética, reconciliação dos filtros, isolamento entre empresas, permissões salariais e administrativas selecionadas, principais fluxos financeiros, notícias sintéticas, auditoria, rollback e backtest. Ainda faltam revisão completa de autorização, navegador desktop/celular, backup/restauração, segurança operacional e demais itens do gate.
- O ambiente local do Wrangler não conseguiu iniciar devido a erro de interface de rede do ambiente de execução. Nenhum deploy foi feito; nenhum dado real foi usado.

**Próximo foco:** preparar backup/restauração em homologação isolada e continuar a revisão de autorização rota por rota. Retomar conferência visual quando o ambiente permitir iniciar o Worker e expor a prévia ao navegador; depois avaliar o backtest com histórico mais longo e representativo.

## Princípios de execução

1. **Construir antes de convidar empresas.** Não apresentar o produto como disponível nem solicitar teste externo antes da aprovação dos testes internos.
2. **Usar dados sintéticos nesta etapa.** Não inserir dados financeiros, fiscais, bancários ou de empregados de empresas reais durante a construção e validação interna.
3. **Priorizar consistência e funcionamento.** Não ampliar o número de módulos até que importação, movimentações, indicadores, previsões, notícias e isolamento entre empresas funcionem juntos.
4. **Não prometer precisão sem medição.** Previsões devem mostrar dados usados, premissas, limitações e atualização. Notícias e recomendações devem mostrar fonte e relação com a empresa.
5. **Adiar decisões comerciais.** Preço, planos, checkout, campanha e versão definitiva do site serão decididos após os testes, com base em evidências.

## Etapa 0 — Congelar o escopo da versão de testes

### Entrega

Uma versão de testes com estes fluxos funcionando de ponta a ponta:

- cadastro e acesso de empresa, equipe e administrador da plataforma;
- cadastro e edição de perfil empresarial, segmento e logotipo;
- importação de movimentações, prévia, mapeamento, validação e deduplicação;
- inclusão, edição, exclusão e limpeza de lançamentos, sempre com auditoria;
- movimentações filtradas por período e indicadores reconciliados;
- DRE gerencial preliminar, com classificações, pendências e limitações explícitas;
- previsão financeira e cenários com histórico e premissas visíveis;
- análise setorial e oportunidades apoiadas em dados da empresa;
- notícias pertinentes, com fonte, data, estado de atualização e alternativa econômica quando faltar notícia específica;
- administração de empresas, usuários e trilha de auditoria;
- equipe e prévia de Informe de Rendimentos com dados mensais registrados;
- painel financeiro administrativo em modo de teste, sem cobrança real.

### Fora do escopo desta versão

Não anunciar nem simular como concluídos: Open Finance, integração bancária, ERP/PDV, estoque operacional, fornecedores com pedidos, emissão fiscal ou transmissão à SEFAZ. São projetos posteriores, que exigem definição técnica, validação regulatória e integrações próprias. A importação de planilhas deve aceitar formatos e estruturas comuns com mapeamento guiado; não se deve prometer que qualquer arquivo, sem exceção, será importado automaticamente.

### Critério de aprovação

Escopo documentado, uma única implantação de testes identificada, dados fictícios isolados e lista de funcionalidades com estado real: disponível, limitado ou ainda não implementado.

## Etapa 1 — Corrigir a base de movimentações

### Trabalho

- Definir um formato interno único para cada lançamento, com valor em centavos, tipo, data de movimento e competência separadas, descrição, categoria e identificadores de origem.
- Implementar importação em duas fases: leitura e prévia sem gravação; confirmação com resumo de aceitos, recusados e possíveis duplicados.
- Suportar CSV, TSV e XLSX com separadores, codificações, nomes de colunas e formatos de data usuais no Brasil; permitir escolher aba, linha de cabeçalho e mapear colunas.
- Validar arquivo vazio, colunas ausentes, valores inválidos, datas ambíguas, débito/crédito, fórmulas e limites. Erros devem apontar linha e motivo.
- Fazer gravação atômica: se o lote falhar, nenhum lançamento daquele lote deve ficar parcialmente salvo.
- Tornar reimportações idempotentes e explicar quando dois lançamentos legítimos se parecem com duplicados.
- Conferir inclusão, edição, exclusão, exclusão em lote e auditoria em todos os caminhos.
- Garantir que arquivo, prévia, totais e registros persistidos correspondam à mesma empresa autenticada.

### Testes de aceite

- Reimportar o mesmo arquivo não aumenta os totais.
- Lançamentos com identificadores distintos não são descartados só por terem data e valor iguais.
- A soma importada coincide com a prévia e com os registros persistidos, em centavos.
- Uma falha no meio da gravação não deixa lote parcial.
- Alterações e exclusões aparecem na auditoria com ator, data e valores anteriores/posteriores.
- A opção de apagar todos exige confirmação e registra quantidade e totais removidos.

## Etapa 2 — Reconciliar indicadores e DRE gerencial

### Trabalho

- Definir formalmente faturamento, despesas, resultado de caixa, margem e saldo; aplicar a mesma definição nas telas, gráficos, filtros e exportações.
- Fazer filtros de 30, 60 e 90 dias e período personalizado usarem exatamente o mesmo conjunto de lançamentos nos totais e nas tabelas.
- Tratar transferências, saldo inicial, estornos, valores não classificados, competência ausente e possíveis duplicidades sem somá-los como receita/despesa indevida.
- Manter a DRE claramente rotulada como gerencial e preliminar. Não chamar de lucro líquido contábil real quando faltarem competência, CMV/CPV/CSP, estoque, tributos, provisões ou ajustes.
- Exibir pendências por valor e quantidade e impedir margem definitiva quando a base estiver incompleta.

### Testes de aceite

- Casos de referência têm totais calculados independentemente e conferem em centavos.
- Mudar o período atualiza todos os indicadores, a memória de cálculo e a exportação.
- Valores pendentes, excluídos, duplicados e sem competência são identificáveis e tratados de forma coerente.
- A classificação confirmada por uma empresa não afeta outra.

## Etapa 3 — Tornar a previsão testável e honesta

### Trabalho

- Separar três camadas: histórico observado; cálculo matemático da projeção; texto e recomendações produzidos pela IA.
- Exibir exercício, intervalo histórico, meses realmente preenchidos, saldo inicial, categorias e taxas considerados.
- Não preencher mês sem movimentação como se fosse mês comprovadamente sem receita. Distinguir mês zerado de mês sem dados.
- Considerar primeiro previsões simples de referência — média histórica e tendência recente — antes de adicionar ajustes de IA.
- Explicar como cada cenário varia e evitar apresentar os cenários como intervalos estatísticos ou garantia de resultado.
- Usar intervalos futuros lançados somente quando existirem dados confiáveis de contas a pagar/receber; até lá, declarar que compromissos futuros não lançados ficam de fora.
- Criar backtest interno: usar meses anteriores como se fossem futuro, comparar projeção com resultado observado e apresentar erro por horizonte.
- Garantir que a resposta da IA não altere totais financeiros nem crie fatos ou notícias. Se a IA falhar, mostrar explicitamente modo de contingência.

### Testes de aceite

- Mesmo conjunto de dados e premissas gera a mesma projeção determinística.
- Dados insuficientes produzem aviso claro e reduzem o nível de conclusão, em vez de falsa precisão.
- As previsões históricas e os resultados usados no backtest podem ser conferidos mês a mês.
- Há relatório com erro de previsão e comparação com a média simples; a palavra “previsão” permanece qualificada até haver evidência suficiente.

## Etapa 4 — Estabilizar notícias e personalização

### Trabalho

- Separar notícias específicas do segmento, notícias econômicas gerais e links de busca; nunca apresentar um link de busca como se fosse notícia publicada.
- Consultar fontes identificáveis e confiáveis; salvar URL canônica, fonte, data de publicação, data da consulta e segmento relacionado.
- Deduplicar notícias e rejeitar conteúdo antigo, sem data ou sem relação com atividade empresarial.
- Definir atualização por cache e limites da fonte; informar “atualizado em” e permitir atualização manual sem sobrecarregar a fonte.
- Se não houver notícia setorial válida, preencher o carrossel com conteúdo econômico geral realmente relacionado à empresa, rotulado como contexto geral. Se nenhuma fonte retornar conteúdo, mostrar o estado da fonte e a última atualização — não fabricar notícia.
- Vincular recomendações aos dados registrados e, quando aplicável, a uma notícia específica. Separar evidência, hipótese e ação sugerida.
- Não reutilizar recomendação genérica com apenas troca do nome do segmento. Sem dados suficientes, dizer o que falta.

### Testes de aceite

- Criar empresas sintéticas de segmentos diferentes e confirmar que notícias e recomendações não são copiadas entre elas.
- Simular fonte indisponível, RSS vazio, notícia duplicada e notícia irrelevante; o painel explica o estado sem quebrar.
- Cada notícia apresentada abre a fonte correta e exibe data e categoria de relevância.
- Toda oportunidade contém sinal, dado que a sustenta, teste pequeno e métrica de avaliação.

## Etapa 5 — Isolamento, segurança e operação

### Trabalho

- Criar testes automatizados de autorização em cada rota: empresa A não pode ler ou alterar dados da empresa B, inclusive perfil, equipe, folha, DRE, cenários, auditoria, arquivos e cache de IA.
- Revisar autenticação, troca/redefinição de senha, sessões, papéis, tentativas de login, cookies, origem das mutações, upload e exposição de mensagens de erro.
- Validar política de senha e recuperação de acesso antes de usar dados reais; não depender de envio manual de senha temporária como processo de produção.
- Documentar privacidade, finalidade, acesso, retenção, exclusão, exportação e resposta a incidente para dados financeiros e de empregados.
- Configurar backup e testar restauração; adicionar logs, alertas para falhas de importação, IA, notícias, e-mail e banco.
- Separar homologação de produção e manter segredos fora do repositório. Usar apenas contas e domínios de teste durante esta etapa.
- Modularizar gradualmente o Worker e criar execução de testes no CI para que regressões sejam detectadas antes de publicar.

### Testes de aceite

- Suíte de isolamento entre empresas passa em todas as rotas protegidas.
- Usuários sem papel autorizado recebem bloqueio consistente.
- Restaurar backup em ambiente isolado recupera dados e auditoria.
- Segredos não aparecem em código, logs ou respostas ao cliente.
- Testes e verificações de segurança são executados automaticamente antes de cada implantação de teste.

## Etapa 6 — Validar equipe, informes e administração

### Trabalho

- Testar importação de pessoas e pagamentos mensais com prévia, duplicidade, competência inválida e reimportação.
- Conferir fórmulas e agrupamento anual de rendimentos tributáveis, isentos, décimo terceiro, previdência e IRRF com casos sintéticos revisados por profissional competente.
- Manter o informe como prévia gerencial até validação profissional; identificar campos faltantes e dados que precisam de conferência.
- Testar cadastro/edição de empresa, aprovação e suspensão de usuários, reset de acesso, auditoria, cobranças, meta financeira e receitas/despesas do projeto.
- Manter cobrança em modo de teste: sem envio real, preço comercial ou assinatura automática até aprovação posterior.

### Testes de aceite

- Totais anuais batem com os lançamentos mensais sintéticos de referência.
- Uma empresa não acessa colaboradores ou informes de outra.
- Ações administrativas relevantes ficam registradas na auditoria.
- E-mail e cobrança têm estados claros: teste, rascunho, enviado ou falha.

## Etapa 7 — Teste interno de aceitação ponta a ponta

Executar, em navegador desktop e celular, do início ao fim, com empresas e pessoas fictícias:

1. Criar duas empresas de segmentos diferentes e usuários com papéis diferentes.
2. Importar planilhas sintéticas válidas e problemáticas; revisar prévias, confirmar importações e reimportar arquivos.
3. Conferir persistência por empresa, duplicidades, edição, exclusão e auditoria.
4. Conferir filtros, dashboard, indicadores, DRE e exportações contra cálculos independentes.
5. Conferir previsão, cenários, premissas e resultado de backtest.
6. Simular feed de notícias disponível e indisponível; confirmar personalização e contingência.
7. Cadastrar equipe e valores mensais sintéticos; conferir a prévia de informe e o fluxo administrativo.
8. Reiniciar sessões, tentar acessos não autorizados, testar backup e recuperar a cópia.

### Gate para considerar a ferramenta pronta para teste externo

- Nenhum erro crítico ou alto aberto.
- Todos os totais financeiros de referência conferem em centavos.
- Importações válidas, inválidas e repetidas têm resultado previsível e explicado.
- Isolamento entre empresas aprovado em testes automatizados e manuais.
- Fluxo principal executado sem intervenção de desenvolvedor.
- Nenhuma tela promete operação ainda inexistente.
- Falhas de IA, e-mail, banco ou notícias são recuperáveis e claramente comunicadas.
- Dados utilizados são sintéticos; documentação de teste e limitações acompanha a versão.

## Etapa 8 — Somente depois da aprovação interna

1. Convidar um pequeno grupo de empresas para teste controlado, com escopo, consentimento e suporte definidos.
2. Corrigir problemas encontrados e repetir os testes de regressão.
3. Medir uso, erros, tempo poupado, decisões tomadas e qualidade percebida da previsão.
4. Só depois desses resultados definir preço, planos, cobrança e suporte comercial.
5. Reformular o site com a funcionalidade comprovada, conteúdo verdadeiro, limitações visíveis e sem incorporar promessas do site atual por presunção.

## Ordem de execução recomendada

1. Escopo e critérios de aceite.
2. Importação, movimentações, auditoria e isolamento por empresa.
3. Indicadores e DRE gerencial reconciliados.
4. Previsões com backtest e premissas visíveis.
5. Notícias, personalização e contingência.
6. Segurança, backup, operação e CI.
7. Equipe, informes e administração.
8. Testes internos ponta a ponta e correções.
9. Teste controlado com empresas.
10. Preços e reformulação definitiva do site.

**Regra de bloqueio:** se uma etapa não cumprir seus critérios, a seguinte não é considerada concluída. A ferramenta só é oferecida para teste externo depois de passar integralmente pelo gate interno da Etapa 7.
