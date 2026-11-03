# Prospecção em etapas e campanha aberta (fork Genuine)

As capturas desta pasta são gravadas por `tests/e2e/prospeccao-em-etapas.spec.ts`, no tema escuro, num banco fresco: a porta de entrada (dois botões e a faixa "Onde você parou"), a etapa 1 (Prospecção), a etapa 2 (Suas campanhas e Acompanhar resultados) e a campanha aberta por um endereço que não existe.

A máquina de desenvolvimento do fork não tem Docker nem Supabase local, então a spec roda no CI (`e2e`, parte 7, criada pelo relógio no PR #23 do fork) e sobe a pasta no artefato `evidencia-parte-7`. Quem fecha a entrega baixa o artefato e commita as imagens aqui; enquanto elas não estão versionadas, este README não as cita pelo nome, de propósito (cerca `tests/unit/evidencia-citada.test.ts`).

A campanha aberta com empresas de verdade (mapa de bairros, lista, botão de abordar) não tem captura automática: o banco fresco do CI não tem campanha. A prova dessa tela é por unidade (`tests/unit/prospeccao-em-etapas.test.tsx`) e pela VPS depois da release.
