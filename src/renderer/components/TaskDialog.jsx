import React, { useState, useEffect, useCallback, useRef, memo } from "react";
import { format, startOfDay, isSameDay } from "date-fns";
import { CalendarDays, Plus, Trash2, Loader2, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { Calendar } from "./ui/calendar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Separator } from "./ui/separator";
import { Badge } from "./ui/badge";
import { EmptyState } from "./ui/empty-state";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./ui/select";
import CancelButton from "./CancelButton";

const NO_TIME = "__none";

const TIME_SLOTS = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, "0");
  const m = String((i % 4) * 15).padStart(2, "0");
  return `${h}:${m}`;
});

const sortTasks = (list) =>
  [...list].sort((a, b) => {
    const ta = a.task_time || "";
    const tb = b.task_time || "";
    if (ta !== tb) return ta.localeCompare(tb);
    return String(a.id).localeCompare(String(b.id));
  });

const TaskDialog = memo(({ open, onClose, onTasksChange }) => {
  const [taskDate, setTaskDate] = useState(() => startOfDay(new Date()));
  const [viewMonth, setViewMonth] = useState(() => startOfDay(new Date()));
  const [tasks, setTasks] = useState([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskTime, setNewTaskTime] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [removingIds, setRemovingIds] = useState(() => new Set());

  const taskDateRef = useRef(taskDate);
  const onTasksChangeRef = useRef(onTasksChange);
  const tasksRef = useRef(tasks);
  const mountedRef = useRef(true);
  const tempIdMapRef = useRef(new Map());
  const pendingDeletesRef = useRef(new Map());

  useEffect(() => {
    taskDateRef.current = taskDate;
  }, [taskDate]);

  useEffect(() => {
    onTasksChangeRef.current = onTasksChange;
  }, [onTasksChange]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const loadTasksForDate = useCallback(async (date) => {
    const result = await window.api.invoke(
      "get-tasks-by-date",
      format(date, "yyyy-MM-dd")
    );
    if (result.success) setTasks(result.tasks);
  }, []);

  useEffect(() => {
    if (open) {
      setViewMonth(taskDate);
      loadTasksForDate(taskDate);
    }
  }, [open, taskDate, loadTasksForDate]);

  const handleDateSelect = useCallback((newDate) => {
    if (newDate) {
      setTaskDate(startOfDay(newDate));
      setViewMonth(startOfDay(newDate));
    }
  }, []);

  const handleGoToday = useCallback(() => {
    const today = startOfDay(new Date());
    setTaskDate(today);
    setViewMonth(today);
  }, []);

  const handleAddTask = useCallback(async () => {
    if (!newTaskTitle.trim() || isAdding) return;
    setIsAdding(true);
    const title = newTaskTitle.trim();
    const time = newTaskTime || null;
    const tempId = `temp-${Date.now()}`;
    setTasks((prev) =>
      sortTasks([
        ...prev,
        { id: tempId, title, description: "", task_time: time, completed: 0 },
      ])
    );
    setNewTaskTitle("");
    setNewTaskTime("");
    try {
      const result = await window.api.invoke("add-task", {
        title,
        description: "",
        taskDate: format(taskDateRef.current, "yyyy-MM-dd"),
        taskTime: time,
        reminderMinutes: 0,
      });
      if (result?.success && result.id != null) {
        tempIdMapRef.current.set(tempId, result.id);
        setTasks((prev) =>
          prev.map((t) => (t.id === tempId ? { ...t, id: result.id } : t))
        );
      } else {
        await loadTasksForDate(taskDateRef.current);
      }
    } catch {
      await loadTasksForDate(taskDateRef.current);
    } finally {
      setIsAdding(false);
    }
    onTasksChangeRef.current?.();
  }, [newTaskTitle, newTaskTime, isAdding, loadTasksForDate]);

  const handleCompleteTask = useCallback(async (taskId) => {
    const realId = tempIdMapRef.current.get(taskId) ?? taskId;
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, completed: 1 } : t))
    );
    try {
      await window.api.invoke("complete-task", realId);
    } catch {
      await loadTasksForDate(taskDateRef.current);
    }
    onTasksChangeRef.current?.();
  }, [loadTasksForDate]);

  const handleDeleteTask = useCallback(
    (taskId) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task) return;
      pendingDeletesRef.current.set(taskId, task);

      setRemovingIds((prev) => new Set(prev).add(taskId));
      window.setTimeout(() => {
        if (!mountedRef.current) return;
        const idSet = new Set([taskId, tempIdMapRef.current.get(taskId)]);
        setTasks((prev) => prev.filter((t) => !idSet.has(t.id)));
        setRemovingIds((prev) => {
          const s = new Set(prev);
          s.delete(taskId);
          return s;
        });
      }, 150);

      const finalizeDelete = () => {
        if (!pendingDeletesRef.current.has(taskId)) return;
        pendingDeletesRef.current.delete(taskId);
        const realId = tempIdMapRef.current.get(taskId) ?? taskId;
        if (realId !== taskId) tempIdMapRef.current.delete(taskId);
        window.api
          .invoke("delete-task", realId)
          .catch(() => loadTasksForDate(taskDateRef.current));
        onTasksChangeRef.current?.();
      };

      const undoDelete = () => {
        if (!pendingDeletesRef.current.has(taskId)) return;
        pendingDeletesRef.current.delete(taskId);
        setTasks((prev) => sortTasks([...prev, task]));
      };

      toast("Tarea eliminada", {
        description: task.title,
        duration: 5000,
        action: { label: "Deshacer", onClick: undoDelete },
        onDismiss: finalizeDelete,
        onAutoClose: finalizeDelete,
      });
    },
    [loadTasksForDate]
  );

  const today = startOfDay(new Date());
  const isToday = isSameDay(taskDate, today);
  const isPastDate = taskDate < today;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays size={20} className="text-blue-500" />
            Tareas
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-[300px] flex-col gap-4 sm:flex-row">
          <div className="flex-none">
            <div className="rounded-md border bg-card p-2">
              <Calendar
                mode="single"
                selected={taskDate}
                onSelect={handleDateSelect}
                month={viewMonth}
                onMonthChange={setViewMonth}
                className="w-[276px]"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleGoToday}
                className="mt-1.5 w-full"
              >
                Hoy
              </Button>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <p className="mb-1 flex items-center gap-2 text-sm font-semibold">
              Tareas del {format(taskDate, "dd/MM/yyyy")}
              {tasks.length > 0 && (
                <Badge
                  variant="secondary"
                  className="px-1.5 py-0 text-[10px] font-semibold"
                >
                  {tasks.length}
                </Badge>
              )}
            </p>
            <div className="mb-1.5 max-h-[220px] space-y-0.5 overflow-y-auto pr-1">
              {tasks.length === 0 ? (
                <EmptyState
                  className="py-6"
                  icon={<ClipboardList size={26} />}
                  title="Sin tareas"
                  description={`No hay tareas para el ${format(taskDate, "dd/MM/yyyy")}`}
                />
              ) : (
                tasks.map((t, index) => {
                  const removing = removingIds.has(t.id);
                  const base = t.completed
                    ? "border-l-emerald-500 bg-emerald-500/10"
                    : isPastDate
                      ? "border-l-red-400 bg-red-500/5 hover:bg-red-500/10"
                      : isToday
                        ? "border-l-blue-500 bg-blue-500/5 hover:bg-slate-400/10"
                        : "border-l-slate-300 dark:border-l-slate-600 hover:bg-slate-400/10";
                  return (
                    <div
                      key={t.id}
                      className={`flex items-center gap-2 rounded-md border-l-2 py-1 pl-2 pr-1.5 ${base} ${
                        removing
                          ? "animate-out fade-out-0 slide-out-to-left-2 duration-150 pointer-events-none"
                          : "animate-in fade-in-0 slide-in-from-top-1 duration-150"
                      }`}
                      style={
                        removing
                          ? undefined
                          : { animationDelay: `${Math.min(index, 8) * 30}ms` }
                      }
                    >
                      <Checkbox
                        checked={!!t.completed}
                        onCheckedChange={() => handleCompleteTask(t.id)}
                      />
                      <span
                        className={`flex-1 text-sm font-medium ${
                          t.completed
                            ? "text-muted-foreground line-through"
                            : "text-foreground"
                        }`}
                      >
                        {t.title}
                      </span>
                      {t.task_time && (
                        <span className="min-w-[40px] text-right text-xs text-slate-500">
                          {t.task_time}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDeleteTask(t.id)}
                        className="text-slate-400 hover:bg-transparent hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  );
                })
              )}
            </div>

            <Separator className="my-2" />

            <p className="mb-1 text-sm font-semibold">Nueva tarea</p>
            <div className="flex items-center gap-1.5">
              <Input
                className="h-9 min-w-0 flex-1 rounded-md"
                placeholder="Título"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddTask();
                }}
              />
              <Select
                value={newTaskTime || NO_TIME}
                onValueChange={(v) => setNewTaskTime(v === NO_TIME ? "" : v)}
              >
                <SelectTrigger className="h-9 w-[108px] shrink-0 rounded-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TIME}>Sin hora</SelectItem>
                  {TIME_SLOTS.map((slot) => (
                    <SelectItem key={slot} value={slot}>
                      {slot}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="icon"
                onClick={handleAddTask}
                disabled={isAdding}
                className="h-9 w-9 shrink-0 rounded-md"
              >
                {isAdding ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Plus size={18} />
                )}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <CancelButton onClick={onClose}>Cerrar</CancelButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

export default TaskDialog;