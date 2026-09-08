import { SaveIcon, Search, LoaderIcon } from "lucide-react";
import { CreditCard } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  Item,
  ItemContent,
  ItemMedia,
  ItemTitle,
  Kbd,
  Progress,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui";
import { EmptyState } from "./ui/empty-state";

const Section = ({ title, description, children }) => (
  <Card>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      {description && <CardDescription>{description}</CardDescription>}
    </CardHeader>
    <CardContent className="space-y-4">{children}</CardContent>
  </Card>
);

const UiKit = () => {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Kit de componentes</h1>
        <p className="text-sm text-muted-foreground">
          Primitivos modernos de shadcn: valídate aquí y decidimos dónde
          aplicarlos en el sistema.
        </p>
      </div>

      <Section
        title="InputGroup"
        description="Input con addons (icono / texto / spinner) a los lados."
      >
        <InputGroup className="max-w-xs">
          <InputGroupInput placeholder="Search..." />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupAddon align="inline-end">12 results</InputGroupAddon>
        </InputGroup>

        <div className="grid w-full max-w-sm gap-4">
          <InputGroup>
            <InputGroupInput placeholder="Searching..." />
            <InputGroupAddon align="inline-end">
              <Spinner />
            </InputGroupAddon>
          </InputGroup>
          <InputGroup>
            <InputGroupInput placeholder="Saving changes..." />
            <InputGroupAddon align="inline-end">
              <InputGroupText>Saving...</InputGroupText>
              <Spinner />
            </InputGroupAddon>
          </InputGroup>
          <InputGroup>
            <InputGroupInput placeholder="Refreshing data..." />
            <InputGroupAddon>
              <LoaderIcon className="animate-spin" />
            </InputGroupAddon>
            <InputGroupAddon align="inline-end">
              <InputGroupText className="text-muted-foreground">
                Please wait...
              </InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </Section>

      <Section
        title="Spinner en Botones"
        description="Botones con estado de carga usando Spinner."
      >
        <div className="flex flex-col items-center gap-4">
          <Button disabled size="sm">
            <Spinner data-icon="inline-start" />
            Loading...
          </Button>
          <Button variant="outline" disabled size="sm">
            <Spinner data-icon="inline-start" />
            Please wait
          </Button>
          <Button variant="secondary" disabled size="sm">
            <Spinner data-icon="inline-start" />
            Processing
          </Button>
        </div>
      </Section>

      <Section
        title="Spinner en Badges"
        description="Spinner como badge de estado (syncing, updating)."
      >
        <div className="flex items-center gap-4 [--radius:1.2rem]">
          <Badge>
            <Spinner data-icon="inline-start" />
            Syncing
          </Badge>
          <Badge variant="secondary">
            <Spinner data-icon="inline-start" />
            Updating
          </Badge>
          <Badge variant="outline">
            <Spinner data-icon="inline-start" />
            Processing
          </Badge>
        </div>
      </Section>

      <Section title="Kbd" description="Teclas de atajo dentro de botones.">
        <Button variant="outline">
          Accept{" "}
          <Kbd data-icon="inline-end" className="translate-x-0.5">
            ⏎
          </Kbd>
        </Button>
      </Section>

      <Section
        title="Item + Spinner"
        description="Fila de procesamiento con media, contenido y monto."
      >
        <div className="flex w-full max-w-xs flex-col gap-4 [--radius:1rem]">
          <Item variant="muted">
            <ItemMedia>
              <Spinner />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="line-clamp-1">
                Processing payment...
              </ItemTitle>
            </ItemContent>
            <ItemContent className="flex-none justify-end">
              <span className="text-sm tabular-nums">$100.00</span>
            </ItemContent>
          </Item>
        </div>
      </Section>

      <Section
        title="Tooltip con atajo de teclado"
        description="Tooltip mostrando la tecla de atajo (Kbd)."
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon-sm">
              <SaveIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Save Changes <Kbd>S</Kbd>
          </TooltipContent>
        </Tooltip>
      </Section>

      <Section
        title="Progress con color"
        description="Barra de progreso con color por estado (base para el medidor de stock)."
      >
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>Alto (primary)</span>
              <span>70%</span>
            </div>
            <Progress value={70} />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>Bajo (ámbar)</span>
              <span>40%</span>
            </div>
            <Progress value={40} indicatorClassName="bg-amber-500" />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>Crítico (rojo)</span>
              <span>15%</span>
            </div>
            <Progress value={15} indicatorClassName="bg-red-500" />
          </div>
        </div>
      </Section>

      <Section title="EmptyState" description="Estado vacío reutilizable.">
        <EmptyState
          icon={<CreditCard className="h-8 w-8" />}
          title="No hay productos registrados"
          description="Agrega tu primer producto para comenzar a vender."
          action={<Button size="sm">Nuevo producto</Button>}
        />
      </Section>
    </div>
  );
};

export default UiKit;
