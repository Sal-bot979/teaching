# Held-out transfer items (answer keys)

**Don't read this before the session.** These items are never posted in a session. They're answered cold 7 days later ([retention protocol](../evals/retention-protocol.md)). Score each one 0 (wrong or blank), 1 (right method, slip or missing justification) or 2 (right and justified).

Every item changes the surface of what a session teaches: new numbers, a new noise model, a new question. Recognizing the lesson isn't enough to answer it.

---

## 1 · Linear-quadratic model

**LQ-1.** Schedule A: 50 Gy in 25 fractions. Schedule B: 40 Gy in 10 fractions. Using α/β = 3 Gy (late effects) and α/β = 10 Gy (tumour), compare BED for both tissues. Which schedule is worse for late tissue, and which is better for tumour?
> BED = nd(1 + d/(α/β)). A (d = 2): late 50(1 + 2/3) = 83.3 Gy₃; tumour 50(1.2) = 60.0 Gy₁₀. B (d = 4): late 40(1 + 4/3) = 93.3 Gy₃; tumour 40(1.4) = 56.0 Gy₁₀. **B is worse for late tissue (+10 Gy₃) and also lower for tumour (−4 Gy₁₀)**, so A dominates on both counts.

**LQ-2.** Convert a single 8 Gy fraction to EQD2 for α/β = 3 Gy.
> BED = 8(1 + 8/3) = 29.3 Gy₃. EQD2 = BED / (1 + 2/(α/β)) = 29.3 / (5/3) = **17.6 Gy**.

**LQ-3.** A colleague calls LQ "a law of radiobiology." Classify the claim. Name the model's assumptions, and one regime where its predictions are contested.
> It's an **empirical / mechanistically motivated model**, not a physical law. Assumptions: full repair between fractions (usually stated as ≥6 h), no repopulation over the treatment time, and the same α and β throughout. Contested regime: **large doses per fraction** (stereotactic, roughly >8–10 Gy/fx), where some data suggest the survival curve straightens and LQ may overestimate the effect. The question is debated, and a good answer says so.

## 2 · Cross-entropy and maximum likelihood

**ML-1.** Regression with y = f(x) + ε, where ε ~ N(0, σ²) and σ is fixed. Which loss does maximum likelihood give, and why?
> −log N(y | f(x), σ²) = (y − f(x))² / (2σ²) + const, so **MLE = minimizing squared error (MSE)**.

**ML-2.** The same, but ε is Laplace-distributed with fixed scale b.
> −log Laplace = |y − f(x)| / b + const, so **MLE = minimizing absolute error (MAE)**. The noise model *is* the loss.

**ML-3.** A classifier gives p = 0.99 for class 1 and the label is 0. A second one gives p = 0.60 for class 1 on the same example. Compute each cross-entropy loss in nats and explain the asymmetry.
> −ln(0.01) = **4.61 nats** and −ln(0.40) = **0.92 nats**. The log penalty grows without bound as a confident prediction gets more wrong.

**ML-4 (counterexample).** "If a classifier is 100% accurate, it is calibrated." Refute it with a concrete case.
> Take a model that outputs 0.51 for every positive and 0.49 for every negative. With a 0.5 threshold it's 100% accurate, but among cases scored 0.51 the true frequency of class 1 is 1.0, not 0.51. **It's accurate but badly miscalibrated.**

## 3 · Unit economics

**UE-1.** ARPU $100/month, gross margin 80%, monthly churn 4%, CAC $1,200. Compute the simple LTV, LTV:CAC and CAC payback.
> Monthly contribution = $80. LTV = 80 / 0.04 = **$2,000**. LTV:CAC = **1.67**. Payback = 1,200 / 80 = **15 months**.

**UE-2.** Churn falls from 4% to 2%. What happens to LTV and to payback? Why are they different?
> LTV doubles to **$4,000**. Payback stays at **15 months**, because in this model payback depends only on CAC and monthly contribution, not on how long customers stay.

**UE-3.** What retention model is hidden inside LTV = contribution / churn? Name one way real cohorts break it.
> **Constant (geometric) monthly churn**, with expected lifetime 1/churn = 25 months at 4%, and no discounting. Real cohorts usually churn faster early and slower later, so one blended churn rate misstates LTV. This is an identity under an assumed model, not a law.
