---
name: feature-exploration
description: Evaluate a proposed product feature against Agent Controller's goal of centralizing developer workflows before planning or implementation.
---

# Feature Exploration

Agent Controller should reduce the need to leave the application to complete development work. Before proposing or implementing a feature, establish whether it strengthens that goal.

## Explore

Read the relevant product documentation, current user flows, and adjacent implementation. Describe the developer problem in terms of an activity they need to complete.

Assess the proposal against these questions:

- Can the activity be completed inside Agent Controller today or after this feature?
- Does the feature centralize a workflow, or does it send the developer to another program to finish it?
- Does the feature duplicate an existing capability without removing friction?
- What is the smallest product-native version that solves the problem?

Present the finding before implementation. Recommend against features whose main outcome is opening or depending on another application, unless the user explicitly chooses that integration after seeing the trade-off.

## Product-native alternatives

Prefer extending the built-in terminal, editor, diff, task board, checks, prompts, and session handoff. If an external integration is necessary, keep the activity inspectable and actionable in Agent Controller rather than making the external application the primary destination.

## Scope

Do not treat this skill as authorization to implement. Once the user selects a direction, make only the requested changes and preserve unrelated work already in the tree.
