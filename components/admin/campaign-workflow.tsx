import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { CampaignWorkflowStage } from "@/lib/admin/campaign-workflow";

export function CampaignWorkflow({
  stages,
  copy,
}: {
  stages: CampaignWorkflowStage[];
  copy: Dictionary["adminWorkflow"];
}) {
  return (
    <section
      className="admin-campaign-workflow"
      data-campaign-stepper
      aria-labelledby="campaign-workflow-heading"
    >
      <h2 id="campaign-workflow-heading">{copy.workflowHeading}</h2>
      <p className="admin-section-hint">{copy.workflowHint}</p>
      <ol>
        {stages.map((stage) => {
          const text = copy.stages[stage.key];
          const message =
            stage.message in text
              ? text[stage.message as keyof typeof text]
              : text.blocked;
          return (
            <li
              key={stage.key}
              data-campaign-stage={stage.key}
              data-state={stage.state}
            >
              <a href={stage.href}>
                <h3>{text.title}</h3>
                <span className="admin-stage-state">
                  {copy.states[stage.state]}
                </span>
              </a>
              <p>{message}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
