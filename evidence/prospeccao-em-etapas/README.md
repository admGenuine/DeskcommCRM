# Prospecção em etapas e campanha aberta (fork Genuine)

As capturas desta pasta são gravadas por `tests/e2e/prospeccao-em-etapas.spec.ts`, no tema escuro, num banco fresco:

- `porta.png`: a porta de entrada, com os dois botões e a faixa "Onde você parou"
- `etapa-1-prospeccao.png`: a etapa 1, Prospecção
- `etapa-2-campanha.png`: a etapa 2, Campanha (Suas campanhas e Acompanhar resultados)
- `campanha-nao-encontrada.png`: a campanha aberta por um endereço que não existe

A máquina de desenvolvimento do fork não tem Docker nem Supabase local, então a spec roda no CI (`e2e`, parte 6) e sobe a pasta no artefato `evidencia-parte-6`. Quem fecha a entrega baixa o artefato e commita os PNG aqui.

A campanha aberta com empresas de verdade (mapa de bairros, lista, botão de abordar) não tem captura automática: o banco fresco do CI não tem campanha. A prova dessa tela é por unidade (`tests/unit/prospeccao-em-etapas.test.tsx`) e pela VPS depois da release.
