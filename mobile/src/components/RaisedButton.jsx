import React from "react";
import { Button, useTheme } from "react-native-paper";

const RaisedButton = ({ children, style, buttonColor, contentStyle, disabled, ...props }) => {
  const theme = useTheme();
  const color = buttonColor || theme.colors.primary;
  return (
    <Button
      mode="contained"
      buttonColor={color}
      disabled={disabled}
      contentStyle={[{ height: 50 }, contentStyle]}
      style={[
        {
          borderRadius: 12,
          shadowColor: color,
          shadowOpacity: 0.4,
          shadowRadius: 9,
          shadowOffset: { width: 0, height: 5 },
          elevation: 8,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </Button>
  );
};

export default RaisedButton;
