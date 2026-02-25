import "./global.css";
import { useState } from "react";
import { StatusBar } from "expo-status-bar";
import { View, Pressable, Text } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { SettingsProvider } from "./src/context/SettingsContext";
import HomeScreen from "./src/screens/HomeScreen";
import MyScreen from "./src/screens/MyScreen";

type TabKey = "home" | "my";

const TABS: { key: TabKey; icon: string }[] = [
  { key: "home", icon: "🏠" },
  { key: "my", icon: "👤" },
];

function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-row border-t border-gray-200 bg-white"
      style={{ paddingBottom: insets.bottom }}
    >
      {TABS.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onTabChange(tab.key)}
            className="flex-1 items-center py-2.5"
          >
            <Text
              className={`text-xl ${isActive ? "opacity-100" : "opacity-40"}`}
            >
              {tab.icon}
            </Text>
            <View
              className={`mt-1 h-1 w-1 rounded-full ${isActive ? "bg-blue-500" : "bg-transparent"}`}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<TabKey>("home");

  return (
    <View className="flex-1 bg-gray-50">
      <View className="flex-1">
        {activeTab === "home" ? <HomeScreen /> : <MyScreen />}
      </View>
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <StatusBar style="auto" />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <AppContent />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
