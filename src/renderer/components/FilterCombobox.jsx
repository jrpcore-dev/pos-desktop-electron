import React, { useMemo, useState } from "react";
import { ArrowUpDown, ChevronsUpDown } from "lucide-react";
import {
  Button,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui";

// Filtro con búsqueda (categoría, proveedor…): `options` = [{ id, name }],
// `value` = id como texto o "" para "todos".
const FilterCombobox = ({ label, value, options, emptyValue, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Si la lista vino undefined (RPC rechazada), no truena el combobox.
  const opts = options || [];
  const selected = opts.find((o) => String(o.id) === String(value));
  const filtered = useMemo(
    () =>
      query.trim()
        ? opts.filter((o) =>
            o.name.toLowerCase().includes(query.trim().toLowerCase()),
          )
        : opts,
    [opts, query],
  );
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            {selected ? selected.name : emptyValue}
            {open ? (
              <ArrowUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            ) : (
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <Command>
            <CommandInput
              placeholder={`Buscar ${label.toLowerCase()}...`}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>Sin resultados</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value=""
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  {emptyValue}
                </CommandItem>
                {filtered.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={o.name}
                    onSelect={() => {
                      onChange(String(o.id));
                      setOpen(false);
                    }}
                  >
                    {o.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default FilterCombobox;
