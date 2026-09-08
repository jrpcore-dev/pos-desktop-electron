import React, { useRef, useState } from "react";
import { Animated, Pressable, View } from "react-native";

const PressableCard = ({ children, onPress, style, pressedStyle, scaleTo = 0.96, ...props }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const [pressed, setPressed] = useState(false);

  const animateTo = (value) => {
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      speed: 40,
      bounciness: 5,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          setPressed(true);
          animateTo(scaleTo);
        }}
        onPressOut={() => {
          setPressed(false);
          animateTo(1);
        }}
        {...props}
      >
        <View style={[style, pressed && pressedStyle]}>{children}</View>
      </Pressable>
    </Animated.View>
  );
};

export default PressableCard;
