# Backup e restauração da FUTURA AI

## Estado verificado em 17/10/2026

- O `wrangler.jsonc` aponta para uma única base D1 chamada `futura-ai-portal-hml`.
- A base usa o mecanismo de armazenamento `production` do D1 e tem 27 tabelas.
- A API da Cloudflare retornou um bookmark atual de Time Travel para a base principal.
- A verificação de restauração feita no CI usa apenas SQLite e registros sintéticos, em diretório temporário que é apagado ao final.
- Ensaio remoto concluído em uma D1 descartável: schema real aplicado, empresa/usuário/movimento/auditoria sintéticos inseridos, bookmark capturado, outro movimento inserido e rollback executado. As consultas confirmaram que o primeiro movimento e a auditoria permaneceram, o segundo foi revertido e as tabelas continuaram disponíveis. A D1 temporária foi apagada depois da conferência.
- O restore de Time Travel substitui a base no lugar. A D1 principal não foi alvo do ensaio e não houve exportação de seus dados.

## Recuperação rápida com D1 Time Travel

Time Travel é automático para D1 em `version: production`. A retenção depende do plano (7 dias no Workers Free; até 30 dias no Workers Paid, segundo a documentação atual da Cloudflare). O bookmark deve ser obtido e registrado antes de qualquer alteração arriscada.

```sh
npx wrangler d1 info futura-ai-portal-hml
npx wrangler d1 time-travel info futura-ai-portal-hml
```

O restore sobrescreve a base. Nunca execute a linha abaixo no banco ativo como teste; use apenas depois da aprovação do responsável e com o bookmark conferido:

```sh
npx wrangler d1 time-travel restore futura-ai-portal-hml --bookmark='<BOOKMARK_CONFIRMADO>'
```

Depois de qualquer recuperação, conferir tabelas e contagens esperadas por empresa, login, movimentações, trilha de auditoria e um relatório financeiro sintético. Guardar o bookmark de reversão mostrado no resultado do restore.

## Próximo ensaio remoto periódico

1. Criar uma base D1 separada e identificá-la como ambiente de exercício, sem ligar o Worker empresarial a ela.
2. Aplicar `schema.sql` e as migrações suportadas pelo projeto.
3. Inserir empresa, usuário, movimentação e auditoria exclusivamente sintéticos.
4. Obter e registrar o bookmark; inserir um segundo movimento sintético e confirmar que aparece.
5. Restaurar o bookmark anterior somente nessa base de exercício.
6. Confirmar que o primeiro movimento e a auditoria persistem e que o segundo foi revertido; conferir a integridade do schema.
7. Anotar horário, bookmarks e resultado. Apagar a base descartável ao fim, se não for reutilizada.

## Snapshot externo de longo prazo

Time Travel serve à recuperação pontual dentro da retenção do plano. Antes de aceitar dados externos, ainda é necessário definir um backup fora da janela de retenção, com criptografia, acesso restrito, retenção, alerta de falha e teste periódico de restauração. Não enviar exportações de clientes para GitHub ou para o computador local sem um procedimento de proteção de dados aprovado.

## Evidência local automatizada

`npm run check` executa `tests/backup-restore-smoke.cjs`: cria uma base temporária a partir do schema real, grava registros fictícios, cria snapshot SQLite, remove os registros da origem e confirma que a cópia mantém empresa, usuário, movimento, auditoria e `PRAGMA integrity_check = ok`. Isso valida a rotina local de cópia e leitura; não substitui o exercício remoto de Time Travel.
