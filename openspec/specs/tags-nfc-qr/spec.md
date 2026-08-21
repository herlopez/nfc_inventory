# tags-nfc-qr Specification

## Purpose
Convierte cada producto en algo que se consulta acercando el teléfono o apuntando la cámara, generando el enlace del tag, su código QR imprimible y la grabación del tag NFC desde el propio navegador.

## Requirements

### Requirement: El tag guarda solo el enlace, nunca los datos
Un tag NFC o un código QR SHALL contener únicamente el enlace al producto. El sistema MUST NOT grabar en el tag datos de la ficha —precio, existencias, ubicación o estado—, para que esos datos puedan cambiar sin tener que regrabar ni reimprimir nada.

#### Scenario: Cambio de datos tras grabar el tag
- **WHEN** se graba el tag de un producto y después cambian su precio, sus existencias o su ubicación
- **THEN** el tag sigue siendo válido y al escanearlo muestra los datos nuevos, sin regrabarlo

#### Scenario: Contenido del tag
- **WHEN** se lee el contenido de un tag ya grabado
- **THEN** contiene un enlace y ningún dato de la ficha

### Requirement: Enlace corto para los tags
El sistema SHALL ofrecer, además del enlace normal a la ficha, una forma abreviada que lleve al mismo sitio, para que quepa cómodamente en tags de poca capacidad y en códigos QR más simples de imprimir.

#### Scenario: Se abre el enlace corto
- **WHEN** alguien abre la forma abreviada del enlace de un producto
- **THEN** el sistema lo lleva a la ficha de ese producto

#### Scenario: Enlace corto sin sesión
- **WHEN** alguien abre la forma abreviada sin tener sesión
- **THEN** el sistema le pide entrar y después lo lleva a esa misma ficha

### Requirement: Generación del enlace desde la interfaz
El sistema SHALL ofrecer una pantalla donde elegir un producto y obtener su enlace, tomando por defecto la dirección desde la que se sirve la aplicación y permitiendo corregirla cuando el tag vaya a usarse contra otra dirección pública.

El enlace generado MUST codificar el identificador del producto de forma segura dentro de la URL.

#### Scenario: Dirección por defecto
- **WHEN** alguien abre la pantalla de generación
- **THEN** la dirección base propuesta es aquella desde la que se está sirviendo la aplicación

#### Scenario: Dirección corregida a mano
- **WHEN** alguien cambia la dirección base porque el tag se usará contra el dominio público
- **THEN** el enlace, el código QR y lo que se grabe en el tag usan esa dirección

#### Scenario: Identificador con caracteres que requieren codificación
- **WHEN** se genera el enlace de un producto cuyo identificador contiene caracteres que deben codificarse en una URL
- **THEN** el enlace generado los codifica y al abrirlo se resuelve el producto correcto

### Requirement: Código QR imprimible
El sistema SHALL mostrar el código QR del enlace y SHALL permitir descargarlo como imagen para imprimirlo y pegarlo donde no haya tag NFC.

#### Scenario: Descarga del QR
- **WHEN** alguien genera el enlace de un producto y pide descargar su código QR
- **THEN** el sistema le entrega una imagen del código lista para imprimir

#### Scenario: El QR refleja el enlace vigente
- **WHEN** alguien cambia el producto elegido o la dirección base
- **THEN** el código QR mostrado se regenera para el enlace nuevo

### Requirement: Grabación del tag NFC desde el navegador
Donde el navegador lo permita, el sistema SHALL grabar el tag NFC directamente al acercarlo, sin necesidad de instalar ninguna aplicación.

Donde no lo permita, el sistema MUST decirlo con claridad e indicar la alternativa, en lugar de fallar en silencio o dejar creer que se grabó.

#### Scenario: Navegador compatible
- **WHEN** alguien pide grabar el tag desde un navegador que admite la escritura NFC y acerca el tag
- **THEN** el sistema graba en él el enlace del producto y confirma la grabación

#### Scenario: Navegador sin soporte NFC
- **WHEN** alguien pide grabar el tag desde un navegador que no admite la escritura NFC
- **THEN** el sistema avisa de que no está disponible y le indica que puede usar una aplicación externa de grabación

#### Scenario: Falla la grabación
- **WHEN** la grabación no llega a completarse
- **THEN** el sistema lo comunica y no da la operación por buena
