import React from "react";
import { Button } from "./ui/button";

const CancelButton = ({ children = "Cancelar", sx, ...props }) => (
  <Button
    variant="outline"
    className="border-slate-400/70 bg-slate-400/5 text-slate-500 hover:border-slate-400 hover:bg-slate-400/25 hover:text-slate-700 dark:border-slate-500/70 dark:bg-slate-500/10 dark:text-slate-400 dark:hover:border-slate-400 dark:hover:bg-slate-500/40 dark:hover:text-slate-200"
    {...props}
  >
    {children}
  </Button>
);

export default CancelButton;