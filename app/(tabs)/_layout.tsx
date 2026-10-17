import { Tabs } from "expo-router";
import { Text, StyleSheet } from "react-native";
import { colors } from "../../constants/app-theme";

type TabSymbolProps = {
  symbol: string;
  color: string;
  focused: boolean;
};

function TabSymbol({ symbol, color, focused }: TabSymbolProps) {
  return (
    <Text
      style={[
        styles.symbol,
        { color },
        focused && styles.activeSymbol,
      ]}
    >
      {symbol}
    </Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: {
          backgroundColor: colors.background,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
        tabBarItemStyle: {
          paddingVertical: 4,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <TabSymbol symbol="⌂" color={color} focused={focused} />
          ),
        }}
      />

      <Tabs.Screen
        name="scan"
        options={{
          title: "Scan",
          tabBarIcon: ({ color, focused }) => (
            <TabSymbol symbol="▣" color={color} focused={focused} />
          ),
        }}
      />

      <Tabs.Screen
        name="swaps"
        options={{
          title: "Food swaps",
          tabBarIcon: ({ color, focused }) => (
            <TabSymbol symbol="⇄" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  symbol: {
    fontSize: 26,
    lineHeight: 30,
  },
  activeSymbol: {
    fontWeight: "700",
  },
});