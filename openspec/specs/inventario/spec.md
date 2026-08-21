# inventario Specification

## Purpose
Guarda la ficha de cada herramienta o equipo —qué es, dónde está, en qué estado y cuánto hay— y permite consultarla desde el tag y mantenerla al día desde el navegador.

## Requirements

### Requirement: Consulta del inventario completo
El sistema SHALL entregar, a quien tenga sesión, la lista completa de productos en un orden estable, junto a los datos de presentación que la interfaz necesita para pintarla.

#### Scenario: Listado con sesión
- **WHEN** una persona con sesión pide el inventario
- **THEN** el sistema devuelve todos los productos en orden estable, con la moneda configurada y la identidad de quien consulta

#### Scenario: Inventario vacío
- **WHEN** no hay ningún producto dado de alta
- **THEN** el sistema devuelve una lista vacía, no un error

### Requirement: Consulta de un producto por identificador o referencia
El sistema SHALL localizar un producto tanto por su identificador como por su referencia de catálogo, sin distinguir mayúsculas en ninguno de los dos, porque un tag puede haberse grabado con la caja cambiada.

Cuando no exista, el sistema SHALL responder 404 indicando qué identificador se buscó.

#### Scenario: Búsqueda por identificador
- **WHEN** se pide la ficha usando el identificador del producto
- **THEN** el sistema devuelve esa ficha

#### Scenario: Búsqueda por referencia de catálogo
- **WHEN** se pide la ficha usando la referencia de catálogo de un producto
- **THEN** el sistema devuelve esa misma ficha

#### Scenario: Diferencia de mayúsculas
- **WHEN** se pide la ficha escribiendo el identificador con distinta caja de la registrada
- **THEN** el sistema devuelve igualmente la ficha correcta

#### Scenario: Producto inexistente
- **WHEN** se pide la ficha de un identificador que no existe
- **THEN** el sistema responde 404 e incluye el identificador buscado

### Requirement: El identificador de un producto es inmutable
Una vez creado un producto, el sistema MUST impedir que su identificador cambie, porque ese identificador ya está grabado en tags NFC y códigos QR que no se pueden regrabar.

La edición de un producto SHALL conservar siempre el identificador existente, aunque la petición traiga otro.

#### Scenario: Se intenta cambiar el identificador al editar
- **WHEN** se envía una edición que incluye un identificador distinto del que tiene el producto
- **THEN** el sistema guarda el resto de los campos y conserva el identificador original

### Requirement: Alta de producto
El sistema SHALL permitir a un usuario autorizado crear un producto indicando su identificador y, como mínimo, su nombre.

El identificador MUST limitarse a caracteres seguros dentro de una URL y a una longitud acotada, porque viaja en el enlace que guarda el tag. El sistema MUST rechazar con 409 el alta cuyo identificador ya exista, comparando sin distinguir mayúsculas, para que no conviva un mismo código escrito de dos formas.

#### Scenario: Alta correcta
- **WHEN** un usuario autorizado crea un producto con un identificador válido y un nombre
- **THEN** el sistema lo guarda y devuelve la ficha resultante

#### Scenario: Identificador ya usado
- **WHEN** se intenta crear un producto con un identificador que ya existe, aunque escrito con distinta caja
- **THEN** el sistema responde 409 y no crea nada

#### Scenario: Identificador con caracteres no admitidos
- **WHEN** se intenta crear un producto cuyo identificador lleva espacios, barras u otros caracteres que no son seguros en una URL
- **THEN** el sistema responde 400 explicando qué caracteres se admiten

#### Scenario: Falta el nombre
- **WHEN** se intenta crear un producto sin nombre
- **THEN** el sistema responde 400 indicando que el nombre es obligatorio

### Requirement: Edición y baja de producto
El sistema SHALL permitir a un usuario autorizado reemplazar todos los campos editables de un producto existente, y SHALL permitirle darlo de baja.

Sobre un producto inexistente, tanto la edición como la baja MUST responder 404.

#### Scenario: Edición correcta
- **WHEN** un usuario autorizado edita un producto existente
- **THEN** el sistema reemplaza sus campos con los enviados y devuelve la ficha actualizada

#### Scenario: Campo omitido en la edición
- **WHEN** una edición no incluye alguno de los campos editables
- **THEN** ese campo queda vacío, porque la edición reemplaza la ficha entera y no la parchea

#### Scenario: Baja correcta
- **WHEN** un usuario autorizado da de baja un producto existente
- **THEN** el sistema lo elimina junto con la foto que tuviera asociada

#### Scenario: Edición o baja de algo que no existe
- **WHEN** se intenta editar o dar de baja un identificador inexistente
- **THEN** el sistema responde 404 y no altera nada

### Requirement: Validación de los datos de un producto
El sistema SHALL validar los datos recibidos antes de guardarlos y SHALL rechazar con 400 y un mensaje concreto los que no cumplan.

Las reglas son:
- El nombre es obligatorio.
- Las cantidades SHALL ser números enteros de cero en adelante.
- Los importes SHALL ser números de cero en adelante y por debajo de un tope razonable.
- La imagen enlazada SHALL ser una dirección web.
- Los campos de texto SHALL recortarse a longitudes acotadas, más holgadas en descripción y notas que en el resto.
- Los campos adicionales libres SHALL estar acotados en número, y cada uno en la longitud de su nombre y de su valor.

El sistema MUST descartar los campos vacíos en lugar de guardarlos como texto en blanco, para que la ficha no muestre filas huecas.

#### Scenario: Cantidad negativa o no entera
- **WHEN** se envía una cantidad negativa, con decimales o que no es un número
- **THEN** el sistema responde 400 explicando que debe ser un entero de cero en adelante

#### Scenario: Importe fuera de rango
- **WHEN** se envía un importe negativo o por encima del tope admitido
- **THEN** el sistema responde 400 explicando el problema

#### Scenario: Imagen enlazada que no es una dirección web
- **WHEN** se envía en el campo de imagen algo que no empieza por un esquema web
- **THEN** el sistema responde 400 indicando que debe ser una dirección web

#### Scenario: Campos vacíos
- **WHEN** se envía la ficha con varios campos en blanco
- **THEN** el sistema los guarda como ausentes y la ficha no muestra esas filas

#### Scenario: Demasiados campos adicionales
- **WHEN** se envían más campos adicionales de los admitidos, o con nombres y valores muy largos
- **THEN** el sistema conserva los que caben dentro de los límites y recorta lo que se pasa

### Requirement: Sello automático de última modificación
El sistema SHALL registrar la fecha de la última modificación de cada producto en cada guardado, sin que haya que indicarla a mano, salvo que la petición traiga una explícita.

#### Scenario: Guardado sin fecha explícita
- **WHEN** se crea o edita un producto sin indicar fecha de actualización
- **THEN** el sistema sella la ficha con la fecha del día

#### Scenario: Guardado con fecha explícita
- **WHEN** se crea o edita un producto indicando una fecha de actualización
- **THEN** el sistema respeta la fecha indicada

### Requirement: Estado del producto con lectura visual
La ficha SHALL admitir un estado y la interfaz SHALL distinguirlos por color, agrupándolos en disponible, en tránsito o no disponible, para que el estado se capte de un vistazo al escanear.

#### Scenario: Producto disponible
- **WHEN** un producto está marcado como disponible
- **THEN** la interfaz lo señala con el color reservado a lo que se puede usar ya

#### Scenario: Producto retenido temporalmente
- **WHEN** un producto está prestado, reservado o en mantenimiento
- **THEN** la interfaz lo señala con el color de aviso

#### Scenario: Producto no disponible
- **WHEN** un producto está agotado, dañado o perdido
- **THEN** la interfaz lo señala con el color de alerta
