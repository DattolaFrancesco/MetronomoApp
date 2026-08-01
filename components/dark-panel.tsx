import { View, type ViewProps } from "react-native";

type DarkPanelProps = ViewProps & {
  radius?: number;
};

export default function DarkPanel({
  children,
  className = "",
  radius = 20,
  style,
  ...rest
}: DarkPanelProps) {
  return (
    <View
      className={`overflow-hidden border border-white/10 bg-white/[0.04] ${className}`}
      style={[{ borderRadius: radius }, style]}
      {...rest}
    >
      {children}
    </View>
  );
}
