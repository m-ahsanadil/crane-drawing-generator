# Decisions

<!-- Written by Ahsan without AI. Only the questions below come from the brief. -->

## 1. Who is the user, and what do they need?

The user is the crane company, mainly its sales and engineering team. When a customer, like a factory, asks for an EOT crane, the company first has to give a basic drawing showing whether the crane fits the customer's building. Right now engineers make this drawing by hand, which takes time. My app takes 4 values (rated load, span, rail height and lifting height) and quickly generates a clear drawing. The sales team can share it with the customer early, and the engineers save time.

## 2. What did you assume (crane type, inputs, units, ranges), and why?

**Ranges:** I don't have much practical knowledge of real crane ranges yet, so I used rough, typical values as a starting point:

| Input | Min | Max | Why |
|---|---|---|---|
| Rated load | 1,000 kg | 20,000 kg | Single girder cranes are usually for lighter loads. |
| Span | 5,000 mm | 30,000 mm | Wider halls usually need a double girder. |
| Rail height | 3,000 mm | 20,000 mm | Typical factory hall heights. |
| Lifting height | 1,000 mm | Rail height − 421 mm | The hook cannot go above the hoist. |

My confidence in these numbers is low. The only rule I am sure about is that lifting height must be less than rail height. The other limits depend on each manufacturer, so I would confirm them with the engineers (see Q5).


## 3. Where did each formula or rule come from, and how sure are you?

I used AI to help write the calculations, then went through them to understand the logic. I did not do structural calculations like beam strength. real cranses calculations must be done and checked by qualified engineers.

| Rule | Source | How sure |
|---|---|---|
| Lifting height must be less than rail height | Basic logic: the hook can't go above the hoist | High |
| The drawing layout (girder, rails, hoist, hook, dimension lines) | The reference drawing in the brief | High: I followed it directly |

## 4. What did you leave out on purpose?

My goal was a working first version: 4 inputs and a clear drawing. I left out:

Structural strength calculations, because they need engineering standards, and I'm a developer, not a crane engineer.
Exact component selection (motor, wheel, rope size), because that depends on each manufacturer's own catalog.

## 5. What three questions would you ask our engineers?

"What are your limits for choosing a single girder or a double girder, based on load and span?"
"What is the minimum clearance you need above the rail and at the sides? I want to add a validation warning when the building is too small."
"I dont have any 3rd question in my mind. But when I have more clearer image, i may have more than 3 questions from the engineers."

## 6. What would you do with another week?

With another week, I would:

Add input checks and warnings, for example when lifting height is too close to rail height, so mistakes are caught before the drawing reaches the customer.
Let the user export the drawing as a PDF, so the sales team can send it to the customer directly.
