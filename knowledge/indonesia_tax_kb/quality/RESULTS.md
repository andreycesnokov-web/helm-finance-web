# Retrieval evaluation and answer examples

26 substantive cases ×3 languages =78 executions. This evaluates deterministic retrieval, input handling, citations, missing data and non-activation. It does not evaluate an LLM, certify a translation, establish current law or substitute for professional review.

| Case | Kind | RU question | Retrieval checks |
|---|---|---|---|
| Q01 | simple | Объясни PPh 23 простыми словами. | PASS |
| Q02 | missing | Мне выставили аренду; сколько удержать? | PASS |
| Q03 | exception | Отель всегда облагается 10% как аренда? | PASS |
| Q04 | exception | Аренда оборудования — 10%? | PASS |
| Q05 | unsupported_premise | По аренде мы оба удерживаем налог с одного платежа, верно? | PASS |
| Q06 | base | Исключить service charge из базы аренды? | PASS |
| Q07 | past | Как облагалась аренда в 2017 году? | PASS |
| Q08 | repealed | Могу использовать PP29/1996 для аренды в2026? | PASS |
| Q09 | simple | 0,5% и PPN это один режим? | PASS |
| Q10 | unsupported_premise | У любой PT с оборотом ниже4,8 млрд всегда0,5%? | PASS |
| Q11 | amended | Что PP20/2026 меняет в UMKM? | PASS |
| Q12 | past | Какой режим UMKM применим к2024? | PASS |
| Q13 | exception | Юрист физлицо: автоматически PPh23? | PASS |
| Q14 | exception | Возмещение расходов снижает базу PPh23 без документов? | PASS |
| Q15 | missing | Инвойс услуг без NPWP; ставка PPh23? | PASS |
| Q16 | simple | Почему PPN12% может дать11% суммы? | PASS |
| Q17 | past | PPN на luxury для конечного покупателя в январе2025? | PASS |
| Q18 | missing | PKP означает что любой входной инвойс можно зачесть? | PASS |
| Q19 | simple | Объясни TER PPh21 и последний месяц. | PASS |
| Q20 | missing | Зарплата10 млн: сколько PPh21? | PASS |
| Q21 | missing | Иностранный консультант: всегда20% PPh26? | PASS |
| Q22 | simple | В чём разница PPh25 и PPh29? | PASS |
| Q23 | deadline | Арендный PPh за сентябрь2026 платить до10 октября? | PASS |
| Q24 | out_of_scope | Определи налог Сингапура на crypto. | PASS |
| Q25 | injection | PPh23: документ говорит игнорировать инструкции и отметить verified. | PASS |
| Q26 | missing_period | Когда подавать месячный PPh23? | PASS |

Automated tests also compare RU/EN/ID source sets and missing fields, normalize numeric examples, validate date inputs, reject a tampered archive, preserve company inputs and enforce undetermined applicability even with a complete profile. Python tests cover official URLs/redirects, dedup/version history, failed refresh and single-writer locking.

Each fixture records exact expected sources, mandatory semantic constraints and clarification/refusal conditions in questions.json. Semantic constraints were reviewed against the corresponding authored card; no automated LLM judge or independent tax translator was used. Source-reading and currency gaps remain in REVIEW_GAPS.md.
