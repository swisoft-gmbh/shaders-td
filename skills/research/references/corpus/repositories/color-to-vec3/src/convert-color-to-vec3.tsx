import { Action, ActionPanel, Clipboard, Form, Icon, LaunchType, open, showHUD } from "@raycast/api";
import type { LaunchProps } from "@raycast/api";
import { useState } from "react";
import { crossLaunchCommand } from "raycast-cross-extension";
import { colorToVec3 } from "./utils/color";

const EXAMPLE_COLOR = "hsl(280 100% 70%)";

type CommandArguments = {
  color: string;
};

type PickerLaunchContext = {
  hex?: string;
};

type CommandProps = LaunchProps<{
  arguments: CommandArguments;
  launchContext?: PickerLaunchContext;
}>;

export default function Command({ arguments: arguments_, launchContext }: CommandProps) {
  const [color, setColor] = useState(launchContext?.hex ?? arguments_.color);
  const conversion = color.trim() ? colorToVec3(color) : undefined;

  async function copyVec3() {
    if (!conversion?.ok) return;

    await Clipboard.copy(conversion.value);
    await showHUD(`Copied ${conversion.value}`);
  }

  async function pickColor() {
    await crossLaunchCommand(
      {
        name: "pick-color",
        extensionName: "color-picker",
        ownerOrAuthorName: "thomas",
        type: LaunchType.UserInitiated,
      },
      {
        // The callback re-launches this command, whose Root Search argument is
        // required. The picked hex from launchContext will replace this value.
        arguments: { color: color.trim() || "#000000" },
      },
    ).catch(() => open("raycast://extensions/thomas/color-picker"));
  }

  return (
    <Form
      actions={
        <ActionPanel>
          {conversion?.ok ? <Action title="Copy Vec3" icon={Icon.Clipboard} onAction={copyVec3} /> : null}
          <Action title="Pick Color" icon={Icon.EyeDropper} onAction={pickColor} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="color"
        title="CSS Color"
        placeholder={EXAMPLE_COLOR}
        value={color}
        onChange={setColor}
        autoFocus
        error={conversion && !conversion.ok ? conversion.error : undefined}
      />

      <Form.Description
        title="Normalized vec3"
        text={conversion?.ok ? conversion.value : "Enter a CSS color to convert it."}
      />
      <Form.Separator />
      <Form.Description
        title="Supported"
        text="Hex, rgb(), rgba(), hsl(), hsla(), hwb(), oklch(), and CSS named colors. Alpha values are accepted and ignored."
      />
    </Form>
  );
}
