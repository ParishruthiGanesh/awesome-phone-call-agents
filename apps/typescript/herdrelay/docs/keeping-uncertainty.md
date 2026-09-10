# Keeping uncertainty

Notes on the one design decision the rest of HerdRelay is built around: an answer the caretaker did
not give must survive all the way to the screen as an answer that was not given.

## The failure this prevents

A caretaker is asked whether the animal shows visible signs of distress and says:

> "I couldn't tell you, I'm not there yet. I'd have to see her."

There are three ways a system can record that.

1. `visibleDistress: false` — a lie. It says somebody looked and saw nothing.
2. `visibleDistress: null`, rendered as an empty cell — technically true, read as "no".
3. `visibleDistress: "unknown"`, rendered in amber next to the answers that *were* given.

Only the third one leads to the right decision, because the operator's next question is "so does
anyone actually know how she is?" and the answer is no.

The same failure with a worse ending: a caretaker who hedges — *"somebody will get to her at some
point"* — recorded as `inspectionAccepted: true`. Now the alert looks handled. Nobody goes.

## Where the uncertainty is preserved

**In the schema.** Every field a person could leave unstated is an enum with an explicit
unclear/unknown member, and the arrival estimate is a string rather than a number:

```json
{
  "inspection_accepted": { "type": "string", "enum": ["yes", "no", "unclear"] },
  "estimated_arrival_minutes": { "type": "string" },
  "visible_distress": { "type": "string", "enum": ["yes", "no", "unknown"] },
  "veterinary_followup_requested": { "type": "string", "enum": ["yes", "no", "unclear"] }
}
```

A boolean field has no way to express "they did not say", so a boolean field forces the model to
invent an answer. This is the whole trick: the way to get honest uncertainty out of a model is to
give it somewhere to put it.

**In the brief.** The caller is told, in the task itself, that an unclear answer is a normal outcome:

> If they still do not give a clear answer, accept that and record it as unclear. Do not guess, do
> not lead them, and never settle an unclear answer as a yes or a no.
>
> If they say they cannot tell whether the animal is in distress, that is "unknown". It is a normal
> and useful answer, not a failure.

**In the validator.** `lib/result.ts` maps `unclear` to `null` and refuses to fill anything in.

**In the UI.** `null` renders as "Not established" in amber, not as "No" in red and not as a blank.

## Fail-closed rules

Validation runs against the structured result *and* the transcript. Each rule that fires downgrades
the outcome to `uncertain`, sets `humanReviewRequired`, and records a reason that is printed on the
result screen.

| Condition | Why it cannot be believed |
| --- | --- |
| `outcome: inspection_confirmed` with no recorded acceptance | The summary contradicts the field it summarizes |
| `outcome: declined` while the inspection was accepted | Same, in the other direction |
| `outcome: followup_requested` with no request recorded | A follow-up nobody asked for is not a follow-up |
| An arrival time for somebody who said they are not going | Two facts that cannot both be true; the estimate is dropped |
| `outcome: unanswered` while the transcript records the caretaker speaking | Somebody answered |
| Any outcome at all when the caretaker never spoke | Nothing can be attributed to a person who said nothing |
| No structured result | Nothing was established; the fields are defaults, not findings |

Two rules have no exception:

- **Any adjustment at all sets `humanReviewRequired`.** If the validator had to touch it, a person
  reads it.
- **Only a clean `inspection_confirmed` may report no review needed.** Every other outcome — declined,
  unanswered, uncertain, follow-up requested — goes to a human by definition.

## What this costs

It costs the demo its best-looking number. Six of the seven shipped scenarios end with human review
required, and only one produces the tidy green result. That ratio is the honest one: a two-minute
phone call to somebody who has not walked to the pen yet mostly establishes that somebody is going
to walk to the pen.

Claiming more than that would be the actual failure.

## What it does not do

The validator checks a result against its own fields and against the transcript. It cannot check
the transcript against what was said in the barn. A misheard answer, recorded confidently and
consistently, passes every rule here. That is a limit of the approach, not an oversight, and it is
why nothing in HerdRelay acts on a result on its own.
